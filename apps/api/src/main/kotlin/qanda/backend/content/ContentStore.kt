package qanda.backend.content

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.authorization.api.*
import qanda.backend.content.api.*
import qanda.backend.identity.IdentityGuards
import qanda.backend.platform.transaction.JdbcTransactions
import qanda.backend.platform.files.FileReady
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

internal typealias Row = Map<String,Any?>
internal fun Row.id(key: String = "id") = this[key] as UUID
internal fun Row.str(key: String) = this[key] as String
internal fun Row.num(key: String) = (this[key] as Number).toLong()
internal fun Row.time(key: String) = (this[key] as Timestamp).toInstant()
internal fun Row.optionalTime(key: String) = (this[key] as Timestamp?)?.toInstant()
internal fun Instant.sql(): Timestamp = Timestamp.from(this)
internal fun ResultSet.id(key: String = "id") = getObject(key,UUID::class.java)
internal fun ResultSet.time(key: String) = getTimestamp(key).toInstant()

@Component
class ContentStore(val jdbc: JdbcTemplate,private val mapper: ObjectMapper,private val tx: JdbcTransactions,private val identity: IdentityGuards) : AuthorizationContentPort {
    private val resource=Any()
    private inner class Held(override val subjectId: UUID,val mode: GuardMode,val transactionId: UUID): SubjectGuard {
        override fun assertHeld(mode: GuardMode) {
            identity.assertCurrentTransaction(transactionId)
            check(state()[subjectId]===this && (mode==GuardMode.SHARE || this.mode==GuardMode.UPDATE)) { "Subject guard is stale or insufficient" }
        }
    }
    private fun state(): LinkedHashMap<UUID,Held> {
        identity.currentTransactionId()
        @Suppress("UNCHECKED_CAST")
        val current=TransactionSynchronizationManager.getResource(resource) as LinkedHashMap<UUID,Held>?
        if(current!=null)return current
        return linkedMapOf<UUID,Held>().also { held ->
            TransactionSynchronizationManager.bindResource(resource,held)
            TransactionSynchronizationManager.registerSynchronization(object: TransactionSynchronization {
                override fun afterCompletion(status: Int) { TransactionSynchronizationManager.unbindResourceIfPossible(resource) }
            })
        }
    }
    fun locks(requests: List<SubjectLock>): List<SubjectGuard> = tx.mandatory {
        check(requests.size in 1..100 && requests.map { it.id }.distinct().size==requests.size)
        val held=state();identity.advanceLockPhaseInTransaction(30)
        for(req in requests.sortedBy { it.id.toString() }) {
            val old=held[req.id]
            if(old!=null) { old.assertHeld(req.mode);continue }
            check(held.isEmpty() || req.id.toString()>held.keys.last().toString()) { "Subjects must be predeclared in UUID order" }
            val lock=if(req.mode==GuardMode.UPDATE)"UPDATE" else "SHARE"
            if(jdbc.queryForList("SELECT id FROM content_subject WHERE id=? FOR $lock",req.id).isEmpty())missing()
            held[req.id]=Held(req.id,req.mode,identity.currentTransactionId())
        }
        requests.map { held.getValue(it.id) }
    }
    override fun lockSubjectInTransaction(subjectId: UUID,mode: GuardMode): AuthorizationSubjectGuard = locks(listOf(SubjectLock(subjectId,mode))).single()
    override fun describeLocked(guard: AuthorizationSubjectGuard): SubjectAccessDescriptor = tx.mandatory {
        guard.assertHeld();check(state()[guard.subjectId]===guard)
        descriptor(subject(guard.subjectId))
    }
    internal fun descriptor(row: Row) = SubjectAccessDescriptor(row.id(),SubjectSource.valueOf(row.str("source")),row["owner_account_id"] as UUID?,row.str("status"),row.str("status")=="ACTIVE",true,true,row.num("content_version"))
    override fun readSchoolMetadataInTransaction(page: Int,pageSize: Int): Page<Pair<SubjectAccessDescriptor,String>> = tx.mandatory {
        paging(page,pageSize)
        page("SELECT s.* FROM content_subject s WHERE source='SCHOOL'",emptyList(),"title,id",page,pageSize,RowMapper { r,_ -> descriptor(r.row()) to r.getString("title") })
    }
    internal fun subject(id: UUID): Row = row("SELECT * FROM content_subject WHERE id=?",id) ?: missing()
    internal fun chapter(subject: UUID,id: UUID): Row = row("SELECT * FROM content_chapter WHERE subject_id=? AND id=?",subject,id) ?: missing()
    internal fun question(subject: UUID,id: UUID): Row = row("SELECT * FROM content_question WHERE subject_id=? AND id=?",subject,id) ?: missing()
    internal fun row(sql: String,vararg args: Any?): Row? = jdbc.queryForList(sql,*args).singleOrNull()
    internal fun bump(subject: UUID,time: Instant) {
        if(jdbc.update("UPDATE content_subject SET content_version=content_version+1,updated_at=? WHERE id=? AND content_version<9007199254740991",time.sql(),subject)!=1)unavailable("CONTENT_VERSION_LIMIT")
    }
    internal fun paging(page: Int,size: Int) { if(page<1 || size !in 1..100)shape("/page") }
    internal fun <T:Any> page(sql: String,args: List<Any?>,order: String,page: Int,size: Int,mapper: RowMapper<T>): Page<T> {
        paging(page,size);var total=0L
        val items=jdbc.query("""WITH matching AS MATERIALIZED ($sql)
            SELECT p.*,(SELECT count(*) FROM matching) result_total FROM (SELECT 1) anchor
            LEFT JOIN LATERAL(SELECT * FROM matching ORDER BY $order LIMIT ? OFFSET ?) p ON true""", { r,_ ->
            total=r.getLong("result_total");if(r.getObject("id")==null)null else mapper.mapRow(r,0)
        },*(args+size+((page-1).toLong()*size)).toTypedArray()).filterNotNull()
        return Page(items,page,size,total)
    }
    internal val subjectMapper=RowMapper { r:ResultSet,_:Int -> SubjectView(r.id(),SubjectSource.valueOf(r.getString("source")),r.getObject("owner_account_id",UUID::class.java),r.getString("title"),r.getString("description"),ContentStatus.valueOf(r.getString("status")),r.getLong("version"),r.getLong("content_version"),r.getLong("chapter_count"),r.getLong("question_count"),r.time("updated_at")) }
    internal val chapterMapper=RowMapper { r:ResultSet,_:Int -> ChapterView(r.id(),r.id("subject_id"),r.getString("title"),ContentStatus.valueOf(r.getString("status")),r.getInt("position"),r.getLong("version"),r.getLong("question_count")) }
    internal val questionMapper=RowMapper { r:ResultSet,_:Int -> QuestionView(r.id(),r.id("subject_id"),r.id("chapter_id"),ContentStatus.valueOf(r.getString("status")),r.getLong("version"),r.getInt("position"),r.id("current_revision_id"),r.getInt("revision_number"),mapper.readTree(r.getString("payload"))) }
    internal val summaryMapper=RowMapper { r:ResultSet,_:Int ->
        val payload=mapper.readTree(r.getString("payload"));val text=payload["stem"]["blocks"].mapNotNull { it.get("text")?.asText() ?: it.get("source")?.asText() ?: it.get("alt")?.asText() }.joinToString(" ")
        QuestionSummary(r.id(),r.id("subject_id"),r.id("chapter_id"),r.id("current_revision_id"),QuestionType.valueOf(payload["type"].asText()),text.take(text.offsetByCodePoints(0,minOf(textLength(text),300))),r.getLong("version"),ContentStatus.valueOf(r.getString("status")),r.getInt("position"))
    }
    internal fun subjectsSql(learn: Boolean): String = """SELECT s.*,
        (SELECT count(*) FROM content_chapter c WHERE c.subject_id=s.id ${if(learn)"AND c.status='ACTIVE'" else ""}) chapter_count,
        (SELECT count(*) FROM content_question q JOIN content_chapter c ON c.id=q.chapter_id WHERE q.subject_id=s.id ${if(learn)"AND c.status='ACTIVE' AND q.status='ACTIVE'" else ""}) question_count FROM content_subject s"""
    internal fun chaptersSql(learn: Boolean) = """SELECT c.*,(SELECT count(*) FROM content_question q WHERE q.chapter_id=c.id ${if(learn)"AND q.status='ACTIVE'" else ""}) question_count FROM content_chapter c"""
    internal val questionsSql="""SELECT q.*,r.revision_number,r.payload FROM content_question q JOIN content_chapter c ON c.id=q.chapter_id JOIN content_question_revision r ON r.id=q.current_revision_id"""
    internal fun revision(question: UUID,revision: UUID): ManagedRevision = jdbc.query("SELECT * FROM content_question_revision WHERE question_id=? AND id=?",RowMapper { r,_ -> ManagedRevision(r.id(),r.id("question_id"),r.getInt("revision_number"),mapper.readTree(r.getString("payload")),r.id("created_by"),r.time("created_at")) },question,revision).singleOrNull() ?: missing()
    internal fun importBatch(subject: UUID,id: UUID,actor: UUID): Row = row("SELECT * FROM content_import_batch WHERE subject_id=? AND id=? AND created_by=?",subject,id,actor) ?: missing()
    internal fun importView(subject: UUID,id: UUID,actor: UUID): ImportView {
        val b=importBatch(subject,id,actor)
        val docs=jdbc.query("SELECT * FROM content_import_document WHERE batch_id=? ORDER BY ordinal",RowMapper { r,_ -> ImportDocumentSummary(r.getInt("ordinal"),r.getString("file_name"),r.id("chapter_id"),mapper.readTree(r.getString("payload")).size()) },id)
        val issues=jdbc.query("SELECT * FROM content_import_issue WHERE batch_id=? ORDER BY document_ordinal,item_index NULLS FIRST,pointer,id",RowMapper { r,_ -> ImportIssue(r.getInt("document_ordinal"),r.getObject("item_index") as Int?,r.getString("pointer"),r.getString("code"),r.getString("severity"),r.getString("message")) },id)
        val created=jdbc.query("SELECT * FROM content_import_created_question WHERE batch_id=? ORDER BY ordinal",RowMapper { r,_ -> CommittedQuestion(r.getInt("ordinal"),r.id("question_id"),r.id("revision_id")) },id)
        return ImportView(id,subject,b.str("state"),b.num("version"),b.num("subject_content_version"),b.time("created_at"),b.time("expires_at"),b.optionalTime("committed_at"),b.optionalTime("cancelled_at"),docs,issues,created)
    }
    internal fun readReadyAttachmentMetadata(ids: List<UUID>,guard: SubjectGuard): List<FileReady> {
        guard.assertHeld()
        if(ids.isEmpty())return emptyList()
        // Issued-revision reads follow the consumer's L40; use one MVCC projection, never acquire L35 here.
        return jdbc.query("""SELECT f.* FROM content_image i JOIN file_asset f ON (f.id,f.subject_id)=(i.file_id,i.subject_id)
            WHERE i.subject_id=? AND f.state='READY' AND f.id IN (${ids.joinToString(",") { "?" }})""",RowMapper { r,_ ->
            FileReady(r.id(),r.getString("media_type"),r.getLong("size_bytes"),r.getString("sha256"),r.getInt("width_pixels"),r.getInt("height_pixels"),r.time("ready_at"))
        },*(listOf(guard.subjectId)+ids).toTypedArray())
    }
    private fun ResultSet.row(): Row = mapOf("id" to id(),"source" to getString("source"),"owner_account_id" to getObject("owner_account_id"),"status" to getString("status"),"content_version" to getLong("content_version"))
}
