package qanda.backend.platform.mail

import org.springframework.jdbc.core.JdbcTemplate
import qanda.backend.platform.transaction.JdbcTransactions
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID

internal data class DeliveryLease(val id: UUID, val owner: String, val attempt: Int, val envelope: PreparedMailEnvelope) {
    override fun toString() = "DeliveryLease($id,$attempt,[REDACTED])"
}
enum class SendState { ACCEPTED, RETRYABLE_FAILED, PERMANENT_FAILED, UNKNOWN, CANCELLED }
data class SendResult(val state: SendState, val providerMessageId: String? = null, val errorCode: String? = null)

class JdbcMailOutbox(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val crypto: MailCrypto, private val clock: Clock) : IdentityMailPort {
    override fun prepareIdentityMailEnvelope(challengeId: UUID, recipient: String, code: String, templateCode: String, templateVersion: Int, expiresAt: Instant) = crypto.prepare(challengeId, recipient, code, templateCode, templateVersion, expiresAt)

    override fun enqueueIdentityMailInTransaction(challengeId: UUID, expiresAt: Instant, encryptedMessageRef: PreparedMailEnvelope, requestId: UUID): UUID = tx.mandatory {
        val e = encryptedMessageRef
        if (e.challengeId != challengeId || e.expiresAt != expiresAt.truncatedTo(ChronoUnit.MILLIS) || e.templateCode !in IDENTITY_MAIL_TEMPLATES || e.templateVersion != 1) mailConflict()
        val digest = crypto.fingerprint(e)
        val dedup = "$challengeId:${e.templateCode}:${e.templateVersion}"
        val now = at()
        val inserted = jdbc.queryForList("""INSERT INTO mail_delivery(id,challenge_id,deduplication_key,envelope_digest,template_code,template_version,state,available_at,expires_at,message_ciphertext,message_nonce,message_key_version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'READY',?,?,?,?,?,?,?) ON CONFLICT(deduplication_key) DO NOTHING RETURNING id""",
            UUID.randomUUID(), challengeId, dedup, digest, e.templateCode, e.templateVersion, now.sql(), e.expiresAt.sql(), Base64.getDecoder().decode(e.ciphertext), Base64.getDecoder().decode(e.nonce), e.keyVersion, now.sql(), now.sql())
        if (inserted.isNotEmpty()) inserted.single()["id"] as UUID
        else {
            val row = jdbc.queryForMap("SELECT id,envelope_digest FROM mail_delivery WHERE deduplication_key=? FOR UPDATE", dedup)
            if (!MessageDigest.isEqual(row["envelope_digest"] as ByteArray, digest)) mailConflict()
            row["id"] as UUID
        }
    }

    internal fun sweep(): Int = tx.required {
        val now = at()
        val expired = jdbc.queryForList("""SELECT id,attempt_count,state,expires_at FROM mail_delivery WHERE
            (state='LEASED' AND (lease_until<=? OR expires_at<=?)) OR
            (state='READY' AND expires_at<=?) OR (state='UNKNOWN' AND expires_at<=? AND message_ciphertext IS NOT NULL)
            ORDER BY expires_at,id LIMIT 10 FOR UPDATE SKIP LOCKED""", now.sql(), now.sql(), now.sql(), now.sql())
        for (row in expired) {
            val id = row["id"] as UUID
            val previous = row["state"] as String
            val state = if (previous == "READY") "CANCELLED" else "UNKNOWN"
            val clear = !(row["expires_at"] as Timestamp).toInstant().isAfter(now) || state == "CANCELLED"
            jdbc.update("""UPDATE mail_delivery SET state=?,lease_owner=NULL,lease_until=NULL,
                message_ciphertext=CASE WHEN ? THEN NULL ELSE message_ciphertext END,message_nonce=CASE WHEN ? THEN NULL ELSE message_nonce END,
                last_error_code=?,updated_at=?,version=version+1 WHERE id=?""", state, clear, clear, if (previous == "LEASED") "LEASE_OR_MATERIAL_EXPIRED" else "EXPIRED", now.sql(), id)
            if (previous == "LEASED") jdbc.update("UPDATE mail_delivery_attempt SET status='UNKNOWN',finished_at=?,error_code='LEASE_OR_MATERIAL_EXPIRED' WHERE delivery_id=? AND attempt_number=? AND status='STARTED'", now.sql(), id, row["attempt_count"])
        }
        expired.size
    }

    internal fun claim(): DeliveryLease? = tx.required {
        val now = at()
        val row = jdbc.queryForList("""SELECT * FROM mail_delivery WHERE state='READY' AND available_at<=? AND expires_at>? AND attempt_count<max_attempts
            ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED""", now.sql(), now.sql()).singleOrNull()
        if (row == null) return@required NoLease
        val id = row["id"] as UUID
        val owner = UUID.randomUUID().toString()
        val attempt = (row["attempt_count"] as Number).toInt() + 1
        jdbc.update("UPDATE mail_delivery SET state='LEASED',lease_owner=?,lease_until=?,attempt_count=?,updated_at=?,version=version+1 WHERE id=?", owner, now.plusSeconds(30).sql(), attempt, now.sql(), id)
        jdbc.update("INSERT INTO mail_delivery_attempt(id,delivery_id,attempt_number,status,started_at) VALUES (?,?,?,'STARTED',?)", UUID.randomUUID(), id, attempt, now.sql())
        val encoder = Base64.getEncoder()
        DeliveryLease(id, owner, attempt, PreparedMailEnvelope(row["challenge_id"] as UUID, row["template_code"] as String, (row["template_version"] as Number).toInt(), (row["expires_at"] as Timestamp).toInstant(), encoder.encodeToString(row["message_ciphertext"] as ByteArray), encoder.encodeToString(row["message_nonce"] as ByteArray), (row["message_key_version"] as Number).toInt()))
    }.let { it as? DeliveryLease }

    internal fun record(lease: DeliveryLease, result: SendResult): Boolean = tx.required {
        val now = at()
        val row = jdbc.queryForList("SELECT max_attempts FROM mail_delivery WHERE id=? AND state='LEASED' AND lease_owner=? AND attempt_count=? AND lease_until>? FOR UPDATE", lease.id, lease.owner, lease.attempt, now.sql()).singleOrNull() ?: return@required false
        val retry = result.state == SendState.RETRYABLE_FAILED && lease.attempt < (row["max_attempts"] as Number).toInt() && lease.envelope.expiresAt.isAfter(now)
        val state = when { retry -> "READY"; result.state == SendState.RETRYABLE_FAILED || result.state == SendState.PERMANENT_FAILED -> "FAILED"; else -> result.state.name }
        val clear = state in setOf("ACCEPTED", "FAILED", "CANCELLED") || !lease.envelope.expiresAt.isAfter(now)
        jdbc.update("""UPDATE mail_delivery SET state=?,available_at=?,lease_owner=NULL,lease_until=NULL,provider_message_id=?,last_error_code=?,
            message_ciphertext=CASE WHEN ? THEN NULL ELSE message_ciphertext END,message_nonce=CASE WHEN ? THEN NULL ELSE message_nonce END,updated_at=?,version=version+1 WHERE id=?""",
            state, now.plusSeconds((1L shl lease.attempt).coerceAtMost(60)).sql(), result.providerMessageId, result.errorCode, clear, clear, now.sql(), lease.id)
        jdbc.update("UPDATE mail_delivery_attempt SET status=?,finished_at=?,provider_message_id=?,error_code=? WHERE delivery_id=? AND attempt_number=? AND status='STARTED'", result.state.name, now.sql(), result.providerMessageId, result.errorCode, lease.id, lease.attempt)
        true
    }

    private fun at() = clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private object NoLease
}
private fun Instant.sql() = Timestamp.from(this)
