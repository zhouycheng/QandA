package qanda.backend.authorization

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import qanda.backend.authorization.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.security.CommandDigests
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

data class AuthorizationCommand(val commandId:UUID,val requestId:UUID,val method:String,val path:String,val contentType:String,val rawBody:ByteArray)
internal data class Mutation(val resourceId:UUID,val version:Long,val changed:Boolean,val target:String,val audit:AuthorizationAuditFact? = null)

@Component
class AuthorizationCommands(private val store:AuthorizationStore,private val digests:CommandDigests) {
    internal fun hasReceipt(actor:AuthorizationActor,operation:String,commandId:UUID):Boolean = store.jdbc.queryForObject(
        "SELECT EXISTS(SELECT 1 FROM authz_command_receipt WHERE actor_account_id=? AND operation=? AND command_id=?)",
        Boolean::class.java,actor.accountId,operation,commandId) == true

    internal fun execute(actor:AuthorizationActor,operation:String,command:AuthorizationCommand,now:Instant,httpStatus:Int=200,apply:()->Mutation):Pair<ChangeReceipt,AuthorizationAuditFact?> {
        store.connection()
        if(command.rawBody.size>16384)throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"PAYLOAD_TOO_LARGE","请求超过16KiB限制")
        val lockKey=ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest("${actor.accountId}/$operation/${command.commandId}".toByteArray())).long
        store.jdbc.queryForList("SELECT pg_advisory_xact_lock(?)",lockKey)
        val found=store.jdbc.queryForList("SELECT * FROM authz_command_receipt WHERE actor_account_id=? AND operation=? AND command_id=?",actor.accountId,operation,command.commandId).singleOrNull()
        if(found!=null) {
            val version=(found["digest_key_version"] as Number).toInt()
            val current=digests.digest(command.method,command.path,command.contentType,command.rawBody,version)
            if(!digests.matches(found["payload_digest"] as ByteArray,current))throw ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_CONFLICT","该请求编号已用于不同内容")
            val id=listOf("college_id","major_id","membership_account_id","subject_id").firstNotNullOf { found[it] as UUID? }
            return ChangeReceipt(command.commandId,id,(found["resulting_version"] as Number).toLong(),found["changed"] as Boolean,(found["confirmed_at"] as java.sql.Timestamp).toInstant()) to null
        }
        val digest=digests.digest(command.method,command.path,command.contentType,command.rawBody)
        val effect=apply()
        val receiptId=UUID.randomUUID()
        store.jdbc.update("""INSERT INTO authz_command_receipt(receipt_id,actor_account_id,operation,command_id,payload_digest,digest_key_version,college_id,major_id,membership_account_id,subject_id,resulting_version,changed,http_status,confirmed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",receiptId,actor.accountId,operation,command.commandId,digest,digests.activeVersion,
            effect.resourceId.takeIf { effect.target=="COLLEGE" },effect.resourceId.takeIf { effect.target=="MAJOR" },effect.resourceId.takeIf { effect.target=="MEMBERSHIP" },effect.resourceId.takeIf { effect.target=="SUBJECT" },effect.version,effect.changed,httpStatus,now.sql())
        val audit=if(!effect.changed)null else effect.audit ?: AuthorizationAuditFact(receiptId,actor.accountId,when(effect.target) { "COLLEGE","MAJOR" -> "ORGANIZATION_CHANGED"; else -> if(operation.endsWith("SHARE")) "USER_SHARE_CHANGED" else "SCHOOL_ACCESS_CHANGED" },effect.target,effect.resourceId,listOf(AuthorizationAuditChange("RESOURCE_VERSION",if(effect.version==1L)null else (effect.version-1).toString(),effect.version.toString())))
        return ChangeReceipt(command.commandId,effect.resourceId,effect.version,effect.changed,now) to audit?.let { if(it.action=="MEMBERSHIP_CHANGED")it else it.copy(eventId=receiptId) }
    }
}
