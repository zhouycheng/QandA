package qanda.backend.content

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import qanda.backend.content.api.MutationResult
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.security.CommandDigests
import java.time.Instant
import java.util.UUID

internal data class ContentCommand(val operation: String,val key: UUID,val requestId: UUID,val method: String,val path: String,val mediaType: String,val bytes: ByteArray)
@Component
class ContentCommands(private val store: ContentStore,private val digests: CommandDigests) {
    internal fun reserve(actor: UUID,cmd: ContentCommand,subject: UUID,now: Instant,image: Boolean = false): Row {
        val digest=digests.digest(cmd.method,cmd.path,cmd.mediaType,cmd.bytes)
        store.jdbc.update("""INSERT INTO content_command_receipt(id,actor_account_id,operation,command_request_id,payload_digest,digest_key_version,state,upload_operation_id,upload_profile_version,subject_id,created_at)
            VALUES(?,?,?,?,?,?,'RESERVED',?,?,?,?) ON CONFLICT(actor_account_id,operation,command_request_id) DO NOTHING""",
            UUID.randomUUID(),actor,cmd.operation,cmd.key,digest,digests.activeVersion,if(image)UUID.randomUUID() else null,if(image)1 else null,subject,now.sql())
        val row=store.row("SELECT * FROM content_command_receipt WHERE actor_account_id=? AND operation=? AND command_request_id=? FOR UPDATE",actor,cmd.operation,cmd.key)!!
        if(!digests.matches(row["payload_digest"] as ByteArray,digests.digest(cmd.method,cmd.path,cmd.mediaType,cmd.bytes,row.num("digest_key_version").toInt())))
            throw ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_CONFLICT","幂等键已用于不同请求")
        if(row.str("state")=="REJECTED")throw ApiException(HttpStatus.valueOf(row.num("rejection_status").toInt()),row.str("rejection_code"),"图片请求未通过验证")
        return row
    }
    internal fun result(row: Row) = MutationResult(row.id("command_request_id"),row.id("subject_id"),row["chapter_id"] as UUID?,row["question_id"] as UUID?,row["revision_id"] as UUID?,row["import_id"] as UUID?,row["file_id"] as UUID?,row.num("version"),row.num("content_version"),row.time("completed_at"))
    internal fun complete(row: Row,result: MutationResult) {
        check(store.jdbc.update("""UPDATE content_command_receipt SET state='SUCCEEDED',chapter_id=?,question_id=?,revision_id=?,import_id=?,file_id=?,version=?,content_version=?,completed_at=? WHERE id=? AND state='RESERVED'""",
            result.chapterId,result.questionId,result.revisionId,result.importId,result.fileId,result.version,result.contentVersion,result.completedAt.sql(),row.id())==1)
    }
}
