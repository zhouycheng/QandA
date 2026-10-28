package qanda.backend.platform.security

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import qanda.backend.platform.persistence.*
import java.util.UUID

data class Actor(val id: UUID, val sessionId: UUID, val kind: String, val clientType: String, val role: String? = null)

@Service
class Commands(private val sql: SystemMapper, private val receipts: CommandReceiptMapper, private val audit: AuditLogMapper,
               private val digests: CommandDigests, private val json: ObjectMapper, private val sessions: Sessions) {
    @Transactional
    fun <T: Any> run(actor: Actor?, key: UUID, operation: String, input: Any, resultType: Class<T>, requestId: UUID, work: () -> T): T {
        actor?.let { sessions.checkInTransaction(it) }
        val scope = actor?.let { "${it.kind}:${it.id}" } ?: "ANONYMOUS"
        sql.lock("command:$scope:$operation:$key")
        val bytes = json.writeValueAsBytes(input)
        val digestPath="/api/v1/commands/"+java.net.URLEncoder.encode(operation,Charsets.UTF_8)
        sql.receipt(scope,operation,key)?.let { old ->
            val expected = digests.digest("POST",digestPath,"application/json",bytes,old.digestKeyVersion)
            if(!digests.matches(expected,old.payloadDigest)) conflict("IDEMPOTENCY_CONFLICT","同一请求标识的内容不同")
            return json.readValue(old.responseJson,resultType)
        }
        val result = work()
        receipts.insert(CommandReceipt().apply {
            id=UUID.randomUUID();this.scope=scope;this.operation=operation;commandId=key;actorUserId=actor?.takeIf { it.kind=="USER" }?.id
            actorAdminId=actor?.takeIf { it.kind=="ADMIN" }?.id;digestKeyVersion=digests.activeVersion
            payloadDigest=digests.digest("POST",digestPath,"application/json",bytes);responseJson=json.writeValueAsString(result)
        })
        audit.insert(AuditLog().apply { id=UUID.randomUUID();actorUserId=actor?.takeIf { it.kind=="USER" }?.id;actorAdminId=actor?.takeIf { it.kind=="ADMIN" }?.id
            this.operation=operation;this.requestId=requestId })
        return result
    }
}

@Service
class LoginAttempts(private val sql: SystemMapper, private val crypto: qanda.backend.identity.IdentityCrypto) {
    fun blocked(scope: String): Boolean = sql.attempt(crypto.rateDigest(scope))?.blockedUntil?.isAfter(java.time.Instant.now()) == true
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    fun failure(scope: String, maximum: Int, minutes: Int, enabled: Boolean) {
        val digest=crypto.rateDigest(scope);sql.lock("login:$scope");val old=sql.attempt(digest)
        val count=if(old?.blockedUntil?.isBefore(java.time.Instant.now())==true) 1 else (old?.failures?:0)+1
        sql.saveAttempt(digest,count,if(enabled && count>=maximum) java.time.Instant.now().plusSeconds(minutes*60L) else null)
    }
    fun clear(scope: String) = sql.clearAttempt(crypto.rateDigest(scope))
}

fun HttpServletRequest.requestId(): UUID = RequestIds.get(this)
