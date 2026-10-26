package qanda.backend.identity

import org.springframework.beans.factory.ObjectProvider
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.mail.IdentityMailPort
import qanda.backend.platform.mail.PreparedMailEnvelope
import qanda.backend.platform.security.CommandDigests
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Instant
import java.util.UUID

class IdentityCommand(
    val operation: String, val commandId: UUID, val requestId: UUID,
    internal val method: String, internal val path: String, internal val contentType: String,
    internal val rawBody: ByteArray,
) { override fun toString() = "IdentityCommand($operation,[REDACTED])" }
internal class ChallengeMaterial(
    val id: UUID, val purpose: String, val recipient: Email, val mac: ByteArray, val keyVersion: Int,
    val expiresAt: Instant, val nextSendAt: Instant, val envelope: PreparedMailEnvelope,
)
internal data class Rate(val purpose: String, val kind: String, val key: String, val seconds: Int, val limit: Int)

@Component
class IdentityEvidence(
    private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val crypto: IdentityCrypto,
    private val digests: CommandDigests, private val guards: IdentityGuards,
    private val mailProvider: ObjectProvider<IdentityMailPort>, private val auditProvider: ObjectProvider<IdentityAuditPort>,
) {
    internal fun receipt(kind: String, scope: UUID, command: IdentityCommand): Row? = jdbc.row(
        "SELECT * FROM identity_command_receipt WHERE scope_kind=? AND scope_id=? AND operation=? AND command_id=?",kind,scope,command.operation,command.commandId)
    internal fun validateReceipt(row: Row, command: IdentityCommand, account: AccountGuard, now: Instant) {
        guards.assertAccountGuard(account)
        if (!digests.matches(row.bytes("payload_digest"),digests.digest(command.method,command.path,command.contentType,command.rawBody,row.number("digest_key_version").toInt()))) conflict("IDEMPOTENCY_CONFLICT","同一幂等键的请求内容不同")
        if (!row.time("expires_at").isAfter(now)) conflict("IDEMPOTENCY_WINDOW_EXPIRED","该命令已超过重试期限")
        if (account.accountId != row.uuid("account_id") || account.status != AccountStatus.ACTIVE || account.credentialVersion != row.number("resulting_credential_version")) conflict("CREDENTIAL_CONTEXT_CHANGED","账号安全状态已变化")
    }
    internal fun saveReceipt(kind: String, scope: UUID, command: IdentityCommand, account: Row, status: Int, now: Instant, changeId: UUID? = null) {
        jdbc.update("""INSERT INTO identity_command_receipt(scope_kind,scope_id,operation,command_id,payload_digest,digest_key_version,
            account_id,resulting_credential_version,http_status,resulting_account_version,email_change_id,confirmed_at,expires_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",kind,scope,command.operation,command.commandId,
            digests.digest(command.method,command.path,command.contentType,command.rawBody),digests.activeVersion,
            account.uuid("id"),account.number("credential_version"),status,account.number("version"),changeId,now.sql(),now.plusSeconds(86400).sql())
    }
    internal fun audit(events: List<IdentityEvent>, commandRequestId: UUID, now: Instant, membership: MembershipAudit? = null) {
        if (events.isEmpty() && membership == null) return
        guards.advanceLockPhaseInTransaction(80)
        try {
            (auditProvider.ifAvailable ?: unavailable("AUDIT_UNAVAILABLE")).appendIdentityAuditInTransaction(events,membership,commandRequestId,now,guards.currentTransactionId())
        } catch (error: ApiException) { throw error }
        catch (_: Exception) { unavailable("AUDIT_UNAVAILABLE") }
    }
    internal fun prepare(purpose: String, recipient: Email, now: Instant, id: UUID = UUID.randomUUID()): ChallengeMaterial {
        val mail = mailProvider.ifAvailable ?: unavailable("MAIL_UNAVAILABLE")
        val code = crypto.randomCode()
        val expires = now.plusSeconds(600)
        val keyVersion = crypto.activeVersion
        val envelope = try { mail.prepareIdentityMailEnvelope(id,recipient.display,code,"IDENTITY_$purpose",1,expires) }
            catch (_: Exception) { unavailable("MAIL_UNAVAILABLE") }
        return ChallengeMaterial(id,purpose,recipient,crypto.proofMac(id,purpose,code,keyVersion),keyVersion,expires,now.plusSeconds(60),envelope)
    }
    internal fun insertChallenge(material: ChallengeMaterial, account: AccountGuard?, eligible: Boolean, now: Instant, requestId: UUID, changeId: UUID? = null): EmailChallenge {
        jdbc.update("""INSERT INTO identity_email_challenge(id,purpose,account_id,recipient,email_key,code_mac,key_version,credential_version,
            eligible,email_change_id,created_at,expires_at,next_send_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            material.id,material.purpose,account?.accountId,material.recipient.display,material.recipient.key,material.mac,material.keyVersion,
            account?.credentialVersion,eligible,changeId,now.sql(),material.expiresAt.sql(),material.nextSendAt.sql())
        if (eligible) {
            try { (mailProvider.ifAvailable ?: unavailable("MAIL_UNAVAILABLE")).enqueueIdentityMailInTransaction(material.id,material.expiresAt,material.envelope,requestId) }
            catch (error: ApiException) { throw error }
            catch (_: Exception) { unavailable("MAIL_UNAVAILABLE") }
        }
        return EmailChallenge(material.id,material.expiresAt,material.nextSendAt)
    }
    /** Bad attempts commit in this short root before any business locks are taken. */
    fun preflightProof(challengeId: UUID, purpose: String, submittedCode: String, accountId: UUID?, now: Instant, requestId: UUID) {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Proof preflight must finish before the business transaction" }
        code(submittedCode)
        val outcome = tx.required {
            val row = jdbc.row("SELECT * FROM identity_email_challenge WHERE id=? FOR UPDATE",challengeId)
            if (row == null || !usable(row,purpose,accountId,now)) false to (row != null && row["eligible"] == true && row.text("purpose") == purpose && row["account_id"] == accountId && row.number("failed_attempts") == 5L)
            else if (matchesCode(row,submittedCode)) true to false
            else {
                val failed = row.number("failed_attempts").toInt()+1
                jdbc.update("UPDATE identity_email_challenge SET failed_attempts=? WHERE id=?",failed,challengeId)
                false to (failed == 5)
            }
        }
        // Count first; a failed failure-audit must never restore a guessed-code attempt.
        if (outcome.second) tx.required { audit(listOf(IdentityEvent(eventId=challengeId,action="AUTH_RATE_LIMITED",actorAccountId=null,targetType="SYSTEM",targetId=null)),requestId,now) }
        if (!outcome.first) invalidProof()
    }
    internal fun usable(row: Row, purpose: String, accountId: UUID?, now: Instant): Boolean =
        row.text("purpose") == purpose && row["account_id"] == accountId && row["eligible"] == true && row.number("failed_attempts") < 5 &&
            row.time("expires_at").isAfter(now) && row["consumed_at"] == null && row["invalidated_at"] == null
    internal fun matchesCode(row: Row, submittedCode: String) = crypto.matches(row.bytes("code_mac"),crypto.proofMac(row.uuid("id"),row.text("purpose"),submittedCode,row.number("key_version").toInt()))
    internal fun lockedProof(id: UUID, purpose: String, submittedCode: String, account: AccountGuard?, now: Instant): Row {
        val row = jdbc.row("SELECT * FROM identity_email_challenge WHERE id=? FOR UPDATE",id) ?: invalidProof()
        if (!usable(row,purpose,account?.accountId,now) || !matchesCode(row,submittedCode) ||
            (account != null && (account.status != AccountStatus.ACTIVE || row.number("credential_version") != account.credentialVersion))) invalidProof()
        return row
    }
    internal fun consume(id: UUID, now: Instant) {
        check(jdbc.update("UPDATE identity_email_challenge SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND invalidated_at IS NULL",now.sql(),id) == 1)
    }
    internal fun reserveRates(rates: List<Rate>, auth: AuthContext?, now: Instant, requestId: UUID) {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Rate reservation must finish before the business transaction" }
        val retry = tx.required {
            if (auth != null) guards.actor(auth,now)
            var wait = 0
            val prepared = rates.map { it to crypto.rateDigest("${it.purpose}:${it.seconds}:${it.key}") }
                .sortedWith(compareBy({ it.first.purpose },{ it.first.kind },{ java.util.HexFormat.of().formatHex(it.second) },{ it.first.seconds }))
            val events = mutableListOf<IdentityEvent>()
            for ((rate,digest) in prepared) {
                val cooldown = rate.purpose == "EMAIL_SEND" && rate.seconds == 60
                val start = if (cooldown) Instant.EPOCH else Instant.ofEpochSecond(Math.floorDiv(now.epochSecond,rate.seconds.toLong())*rate.seconds)
                val end = start.plusSeconds(rate.seconds.toLong())
                val row = if (cooldown) jdbc.row("""INSERT INTO identity_rate_bucket(purpose,scope_kind,scope_digest,window_started_at,window_seconds,used_count,expires_at)
                    VALUES (?,?,?,?,?,1,?) ON CONFLICT(purpose,scope_kind,scope_digest,window_started_at) DO UPDATE SET
                    used_count=CASE WHEN identity_rate_bucket.expires_at<=? THEN 1 ELSE LEAST(identity_rate_bucket.used_count+1,2) END,
                    blocked_until=CASE WHEN identity_rate_bucket.expires_at<=? THEN NULL ELSE identity_rate_bucket.blocked_until END,
                    limit_audit_event_id=CASE WHEN identity_rate_bucket.expires_at<=? THEN NULL ELSE identity_rate_bucket.limit_audit_event_id END,
                    expires_at=CASE WHEN identity_rate_bucket.expires_at<=? THEN EXCLUDED.expires_at ELSE identity_rate_bucket.expires_at END RETURNING *""",
                    rate.purpose,rate.kind,digest,start.sql(),rate.seconds,now.plusSeconds(60).sql(),now.sql(),now.sql(),now.sql(),now.sql())!!
                else jdbc.row("""INSERT INTO identity_rate_bucket(purpose,scope_kind,scope_digest,window_started_at,window_seconds,used_count,expires_at)
                    VALUES (?,?,?,?,?,1,?) ON CONFLICT(purpose,scope_kind,scope_digest,window_started_at)
                    DO UPDATE SET used_count=LEAST(identity_rate_bucket.used_count+1,?) RETURNING *""",
                    rate.purpose,rate.kind,digest,start.sql(),rate.seconds,end.sql(),rate.limit+1)!!
                if (row.number("used_count") > rate.limit) {
                    val blockedUntil = row.time("expires_at")
                    wait = maxOf(wait,(blockedUntil.epochSecond-now.epochSecond).toInt().coerceAtLeast(1))
                    if (row["limit_audit_event_id"] == null) {
                        val event = IdentityEvent(action="AUTH_RATE_LIMITED",actorAccountId=auth?.accountId,targetType=if (auth == null) "SYSTEM" else "ACCOUNT",targetId=auth?.accountId)
                        jdbc.update("""UPDATE identity_rate_bucket SET blocked_until=?,limit_audit_event_id=?
                            WHERE purpose=? AND scope_kind=? AND scope_digest=? AND window_started_at=?""",blockedUntil.sql(),event.eventId,rate.purpose,rate.kind,digest,start.sql())
                        events += event
                    }
                }
            }
            audit(events,requestId,now)
            wait
        }
        if (retry > 0) throw ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","请求过于频繁，请稍后重试",details=ErrorDetails(retryAfterSeconds=retry))
    }
    internal fun checkLoginRate(key: String, source: String, now: Instant, requestId: UUID) {
        for (rate in loginRates(key,source)) {
            val start = Instant.ofEpochSecond(Math.floorDiv(now.epochSecond,rate.seconds.toLong())*rate.seconds)
            val row = jdbc.row("SELECT used_count FROM identity_rate_bucket WHERE purpose=? AND scope_kind=? AND scope_digest=? AND window_started_at=?",
                rate.purpose,rate.kind,crypto.rateDigest("${rate.purpose}:${rate.seconds}:${rate.key}"),start.sql())
            if (row != null && row.number("used_count") >= rate.limit) reserveRates(listOf(rate),null,now,requestId)
        }
    }
    internal fun loginRates(key: String, source: String) = listOf(Rate("LOGIN_FAILURE","EMAIL",key,900,5),Rate("LOGIN_FAILURE","SOURCE",source,3600,100))
    internal fun mailRates(purpose: String, key: String, source: String) = listOf(Rate("EMAIL_SEND","EMAIL","$purpose:$key",60,1),Rate("EMAIL_SEND","EMAIL","$purpose:$key",3600,5),Rate("EMAIL_SEND","SOURCE",source,3600,100))
}
