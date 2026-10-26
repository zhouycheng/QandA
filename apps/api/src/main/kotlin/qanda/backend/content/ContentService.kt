package qanda.backend.content

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataAccessException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import qanda.backend.adminsecurity.api.*
import qanda.backend.authorization.AuthorizationService
import qanda.backend.authorization.api.*
import qanda.backend.content.api.*
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.api.AuthorizationIdentityGuards
import qanda.backend.identity.api.LockMode
import qanda.backend.platform.files.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.transaction.JdbcTransactions
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@Service
class ContentService(
    private val store: ContentStore,private val tx: JdbcTransactions,private val commands: ContentCommands,
    private val identity: AuthorizationIdentityPort,private val guards: IdentityGuards,
    private val authorization: AuthorizationService,private val admin: AdminSecurityOperations,
    private val validation: ContentValidation,private val mapper: ObjectMapper,private val clock: Clock,
    private val fileProviders: ObjectProvider<BinaryAssetPort>,
) : ContentOperations {
    private fun now()=clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private fun files()=fileProviders.ifAvailable ?: unavailable("FILE_PROVIDER_NOT_READY")
    private data class Context(val actor: AuthorizationActor,val accounts: AuthorizationIdentityGuards,val organizations: OrganizationGuards,val admin: AdminContext?)
    private fun context(manage: Boolean = false,schoolRequired: Boolean = false): Context {
        val actor=identity.currentActor()
        val accounts=identity.lockAccountsAndSessionInTransaction(actor,mapOf(actor.accountId to GuardMode.SHARE)) as? AuthorizationIdentityGuards ?: unavailable("IDENTITY_INTEGRATION_NOT_READY")
        val qualification=if(manage)admin.lockQualificationsInTransaction(accounts.accountGuards,mapOf(actor.accountId to LockMode.SHARE)).getValue(actor.accountId) else null
        val proof=if(qualification?.qualified==true || schoolRequired)admin.requireAdminInTransaction(accounts.actor,accounts.actor.account,qualification ?: error("Missing qualification guard")) else null
        val organizations=authorization.prepareAccessInTransaction(actor,accounts)
        return Context(actor,accounts,organizations,proof)
    }
    private data class SubjectContext(val context: Context,val guard: SubjectGuard,val descriptor: SubjectAccessDescriptor,val verdict: AccessVerdict)
    private fun subjectContext(id: UUID,view: ContentView,update: Boolean = false): SubjectContext {
        val discovered=store.subject(id)
        val ctx=context(view==ContentView.MANAGE,view==ContentView.MANAGE && discovered.str("source")=="SCHOOL")
        val guard=store.locks(listOf(SubjectLock(id,if(update)GuardMode.UPDATE else GuardMode.SHARE))).single()
        val descriptor=store.describeLocked(guard)
        val action=if(view==ContentView.LEARN)AccessAction.READ_CURRENT_CONTENT else if(descriptor.source==SubjectSource.SCHOOL)AccessAction.MANAGE_SCHOOL_CONTENT else AccessAction.EDIT_USER_CONTENT
        val verdict=authorization.evaluateLocked(ctx.actor,ctx.accounts,ctx.organizations,guard,descriptor,action,ctx.admin)
        requireAllowed(verdict)
        return SubjectContext(ctx,guard,descriptor,verdict)
    }
    private fun requireAllowed(verdict: AccessVerdict) {
        if(verdict.allowed)return
        if(verdict.denialKind=="MEMBERSHIP_REQUIRED")throw ApiException(HttpStatus.CONFLICT,"MEMBERSHIP_REQUIRED","请先完善学院专业")
        if(verdict.accessGranted)throw ApiException(HttpStatus.CONFLICT,verdict.denialKind ?: "CONTENT_UNAVAILABLE","内容当前不可选择")
        missing()
    }
    private fun <T:Any> root(block: ()->T): T = try { tx.required { store.jdbc.execute("SET LOCAL lock_timeout='3s'");block() } }
        catch(e:DataIntegrityViolationException) {
            if(generateSequence<Throwable>(e) { it.cause }.any { it.message?.contains("content_question_source_unique")==true })invalid("/sourceKey","IMPORT_SOURCE_CONFLICT","科目内来源标识重复")
            unavailable()
        } catch(e:DataAccessException) { unavailable("CONTENT_TEMPORARILY_UNAVAILABLE") }
    private fun version(expected: Long,actual: Long) {
        if(expected!=actual)throw ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","内容已变化，请重新读取",details=ErrorDetails(currentVersion=actual))
    }
    private fun next(value: Long): Long { if(value>=9007199254740991L)unavailable("CONTENT_VERSION_LIMIT");return value+1 }
    private fun expected(input: JsonNode)=input["expectedVersion"].version()
    private fun count(sql: String,vararg args: Any?)=store.jdbc.queryForObject(sql,Long::class.java,*args)!!
    private fun activeChapter(subject: UUID,id: UUID) {
        if(store.chapter(subject,id).str("status")!="ACTIVE")invalid("/chapterId","CHAPTER_INACTIVE")
    }
    private fun checkImages(subject: UUID,payloads: List<ValidatedPayload>) {
        val ids=payloads.flatMap { it.attachments.map(Pair<String,UUID>::second) }.distinct().sortedBy(UUID::toString)
        if(ids.isEmpty())return
        for(id in ids)if(count("SELECT count(*) FROM content_image WHERE file_id=? AND subject_id=?",id,subject)!=1L)invalid("/content","INVALID_FILE_REFERENCE")
        guards.advanceLockPhaseInTransaction(35)
        val metadata=lockImages(subject,ids)
        if(metadata.map { it.fileId }.toSet()!=ids.toSet())invalid("/content","INVALID_FILE_REFERENCE")
    }
    private fun audit(ctx: Context,receipt: Row,cmd: ContentCommand,target: AuditTarget,id: UUID,changes: List<AuditChange>,time: Instant,action: AuditAction = AuditAction.CONTENT_CHANGED) {
        val proof=admin.accountActorInTransaction(ctx.accounts.actor)
        admin.appendAuditInTransaction(listOf(AuditFact(AuditSource.CONTENT,receipt.id(),proof.actor,action,target,id,changes=changes)),listOf(proof),cmd.requestId,time)
    }
    private fun change(before: Long?,after: Long)=listOf(AuditChange(AuditField.RESOURCE_VERSION,before?.toString(),after.toString()))
    private fun receipt(cmd: ContentCommand,subject: UUID,chapter: UUID? = null,question: UUID? = null,revision: UUID? = null,importId: UUID? = null,file: UUID? = null,version: Long,contentVersion: Long,time: Instant)=MutationResult(cmd.key,subject,chapter,question,revision,importId,file,version,contentVersion,time)
    private fun mutate(subject: UUID,cmd: ContentCommand,block: (SubjectContext,Row,Instant)->MutationResult): MutationResult = root {
        val s=subjectContext(subject,ContentView.MANAGE,true);val time=now();val row=commands.reserve(s.context.actor.accountId,cmd,subject,time)
        if(row.str("state")=="SUCCEEDED")commands.result(row) else block(s,row,time).also { commands.complete(row,it) }
    }
    fun listSubjects(view: ContentView,source: SubjectSource?,page: Int,size: Int): Page<SubjectView> = root {
        val ctx=context(view==ContentView.MANAGE)
        val scopes=if(view==ContentView.LEARN)listOf(authorization.authorizedScopeForQuery(ctx.actor,ctx.accounts,ctx.organizations,AccessAction.READ_CURRENT_CONTENT)) else listOf(
            authorization.authorizedScopeForQuery(ctx.actor,ctx.accounts,ctx.organizations,AccessAction.EDIT_USER_CONTENT),
            authorization.authorizedScopeForQuery(ctx.actor,ctx.accounts,ctx.organizations,AccessAction.MANAGE_SCHOOL_CONTENT,ctx.admin))
        val where=scopes.joinToString(" OR ","(",")") { "(${it.predicate})" }+if(source!=null)" AND s.source=?" else ""
        store.page(store.subjectsSql(view==ContentView.LEARN)+" WHERE $where",scopes.flatMap { it.parameters }+listOfNotNull(source?.name),"updated_at DESC,id",page,size,store.subjectMapper)
    }
    fun getSubject(subject: UUID,view: ContentView): SubjectView = root {
        subjectContext(subject,view)
        store.jdbc.query(store.subjectsSql(view==ContentView.LEARN)+" WHERE s.id=?",store.subjectMapper,subject).single()
    }
    internal fun createSubject(input: JsonNode,cmd: ContentCommand): MutationResult = root {
        val source=SubjectSource.valueOf(input["source"].asText());val ctx=context(true,source==SubjectSource.SCHOOL);val time=now()
        val row=commands.reserve(ctx.actor.accountId,cmd,UUID.randomUUID(),time)
        if(row.str("state")=="SUCCEEDED")commands.result(row) else {
            val id=row.id("subject_id")
            store.jdbc.update("INSERT INTO content_subject(id,source,owner_account_id,title,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",id,source.name,if(source==SubjectSource.USER)ctx.actor.accountId else null,title(input["title"]),input.get("description")?.asText() ?: "",ctx.actor.accountId,time.sql(),time.sql())
            val guard=store.locks(listOf(SubjectLock(id,GuardMode.UPDATE))).single()
            authorization.initializeSubjectPolicyInTransaction(guard,store.describeLocked(guard),time)
            val result=receipt(cmd,id,version=1,contentVersion=1,time=time);commands.complete(row,result)
            audit(ctx,row,cmd,AuditTarget.SUBJECT,id,change(null,1)+AuditChange(AuditField.RESOURCE_STATUS,null,"ACTIVE"),time)
            result
        }
    }
    internal fun updateSubject(subject: UUID,input: JsonNode,cmd: ContentCommand,statusOnly: Boolean = false): MutationResult = mutate(subject,cmd) { s,row,time ->
        val old=store.subject(subject);version(expected(input),old.num("version"))
        val newTitle=if(statusOnly)old.str("title") else title(input["title"])
        val description=if(statusOnly)old.str("description") else input["description"].asText()
        val newStatus=if(statusOnly)status(input["status"]) else old.str("status")
        val changed=old.str("title")!=newTitle || old.str("description")!=description || old.str("status")!=newStatus
        val v=if(changed)next(old.num("version")) else old.num("version")
        if(changed) {
            store.jdbc.update("UPDATE content_subject SET title=?,description=?,status=?,version=? WHERE id=?",newTitle,description,newStatus,v,subject);store.bump(subject,time)
            audit(s.context,row,cmd,AuditTarget.SUBJECT,subject,change(old.num("version"),v)+(if(newStatus!=old.str("status"))listOf(AuditChange(AuditField.RESOURCE_STATUS,old.str("status"),newStatus)) else emptyList()),time)
        }
        receipt(cmd,subject,version=v,contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    fun listChapters(subject: UUID,view: ContentView,page: Int,size: Int): Page<ChapterView> = root {
        subjectContext(subject,view)
        store.page(store.chaptersSql(view==ContentView.LEARN)+" WHERE c.subject_id=?"+if(view==ContentView.LEARN)" AND c.status='ACTIVE'" else "",listOf(subject),"position,id",page,size,store.chapterMapper)
    }
    internal fun createChapter(subject: UUID,input: JsonNode,cmd: ContentCommand): MutationResult = mutate(subject,cmd) { s,row,time ->
        version(expected(input),s.descriptor.contentVersion)
        val position=count("SELECT count(*) FROM content_chapter WHERE subject_id=?",subject)+1
        if(position>100)invalid("/title","CONTENT_LIMIT")
        val id=UUID.randomUUID();store.jdbc.update("INSERT INTO content_chapter(id,subject_id,title,position) VALUES(?,?,?,?)",id,subject,title(input["title"]),position)
        store.bump(subject,time);audit(s.context,row,cmd,AuditTarget.CHAPTER,id,change(null,1)+AuditChange(AuditField.RESOURCE_STATUS,null,"ACTIVE"),time)
        receipt(cmd,subject,chapter=id,version=1,contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    internal fun updateChapter(subject: UUID,chapter: UUID,input: JsonNode,cmd: ContentCommand): MutationResult = mutate(subject,cmd) { s,row,time ->
        val old=store.chapter(subject,chapter);version(expected(input),old.num("version"));val name=title(input["title"]);val status=status(input["status"])
        val changed=name!=old.str("title") || status!=old.str("status");val v=if(changed)next(old.num("version")) else old.num("version")
        if(changed) {
            store.jdbc.update("UPDATE content_chapter SET title=?,status=?,version=? WHERE id=?",name,status,v,chapter);store.bump(subject,time)
            audit(s.context,row,cmd,AuditTarget.CHAPTER,chapter,change(old.num("version"),v)+(if(status!=old.str("status"))listOf(AuditChange(AuditField.RESOURCE_STATUS,old.str("status"),status)) else emptyList()),time)
        }
        receipt(cmd,subject,chapter=chapter,version=v,contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    internal fun reorder(subject: UUID,chapter: UUID?,input: JsonNode,cmd: ContentCommand): MutationResult = mutate(subject,cmd) { s,row,time ->
        version(expected(input),s.descriptor.contentVersion);if(chapter!=null)store.chapter(subject,chapter)
        val table=if(chapter==null)"content_chapter" else "content_question";val parent=if(chapter==null)"subject_id" else "chapter_id"
        val old=store.jdbc.queryForList("SELECT id FROM $table WHERE $parent=? ORDER BY position,id",UUID::class.java,chapter ?: subject)
        val ids=input["ids"].map { it.uuid("/ids") }
        if(ids.size!=old.size || ids.toSet()!=old.toSet())invalid("/ids","INVALID_ORDER")
        if(ids!=old) {
            store.jdbc.execute("SET CONSTRAINTS ${table}_position_unique DEFERRED")
            ids.forEachIndexed { i,id -> store.jdbc.update("UPDATE $table SET position=? WHERE id=?",i+1,id) }
            store.bump(subject,time);audit(s.context,row,cmd,AuditTarget.SUBJECT,subject,emptyList(),time)
        }
        val cv=store.subject(subject).num("content_version");receipt(cmd,subject,chapter=chapter,version=cv,contentVersion=cv,time=time)
    }
    fun listQuestions(subject: UUID,chapter: UUID,view: ContentView,type: QuestionType?,page: Int,size: Int): Page<QuestionSummary> = root {
        subjectContext(subject,view);val ch=store.chapter(subject,chapter);if(view==ContentView.LEARN && ch.str("status")!="ACTIVE")missing()
        questionPage(subject,chapter,view,type,null,page,size)
    }
    fun searchQuestions(subject: UUID,query: String,view: ContentView,type: QuestionType?,page: Int,size: Int): Page<QuestionSummary> = root {
        if(textLength(query) !in 1..200)invalid("/q");subjectContext(subject,view);questionPage(subject,null,view,type,query,page,size)
    }
    private fun questionPage(subject: UUID,chapter: UUID?,view: ContentView,type: QuestionType?,query: String?,page: Int,size: Int): Page<QuestionSummary> {
        val predicates=mutableListOf("q.subject_id=?");val args=mutableListOf<Any?>(subject)
        if(chapter!=null) { predicates+="q.chapter_id=?";args+=chapter }
        if(view==ContentView.LEARN)predicates+="q.status='ACTIVE' AND c.status='ACTIVE'"
        if(type!=null) { predicates+="r.payload->>'type'=?";args+=type.name }
        if(query!=null) { predicates+="position(? in r.search_text)>0";args+=query.lowercase(java.util.Locale.ROOT) }
        val sql=store.questionsSql.replace("SELECT q.*,","SELECT q.*,c.position chapter_position,")+" WHERE "+predicates.joinToString(" AND ")
        return store.page(sql,args,"chapter_position,position,id",page,size,store.summaryMapper)
    }
    fun getQuestion(subject: UUID,question: UUID,view: ContentView): QuestionView = root {
        subjectContext(subject,view)
        store.jdbc.query(store.questionsSql+" WHERE q.subject_id=? AND q.id=?"+if(view==ContentView.LEARN)" AND q.status='ACTIVE' AND c.status='ACTIVE'" else "",store.questionMapper,subject,question).singleOrNull() ?: missing()
    }
    fun getRevision(subject: UUID,question: UUID,revision: UUID): ManagedRevision = root {
        subjectContext(subject,ContentView.MANAGE);store.question(subject,question);store.revision(question,revision)
    }
    private fun insertRevision(subject: UUID,question: UUID,revision: UUID,number: Int,value: ValidatedPayload,actor: UUID,time: Instant) {
        val bytes=mapper.writeValueAsBytes(value.payload)
        store.jdbc.update("INSERT INTO content_question_revision(id,question_id,revision_number,payload,content_hash,search_text,created_by,created_at) VALUES(?,?,?,?::jsonb,?,?,?,?)",revision,question,number,String(bytes,Charsets.UTF_8),MessageDigest.getInstance("SHA-256").digest(bytes),value.searchText,actor,time.sql())
        for(id in value.optionIds)store.jdbc.update("INSERT INTO content_option_identity VALUES(?,?) ON CONFLICT(id) DO NOTHING",id,question)
        for((pointer,file) in value.attachments)store.jdbc.update("INSERT INTO content_revision_attachment VALUES(?,?,?)",revision,pointer,file)
    }
    private fun insertQuestion(subject: UUID,chapter: UUID,input: JsonNode,value: ValidatedPayload,actor: UUID,time: Instant): Pair<UUID,UUID> {
        val source=validation.sourceKey(input)
        if(source!=null && count("SELECT count(*) FROM content_question WHERE subject_id=? AND source_key=?",subject,source)>0)invalid("/sourceKey","IMPORT_SOURCE_CONFLICT")
        val position=count("SELECT count(*) FROM content_question WHERE chapter_id=?",chapter)+1
        if(position>10000)invalid("/questions","CONTENT_LIMIT")
        val id=UUID.randomUUID();val revision=UUID.randomUUID()
        store.jdbc.update("INSERT INTO content_question(id,subject_id,chapter_id,source_key,position,current_revision_id) VALUES(?,?,?,?,?,?)",id,subject,chapter,source,position,revision)
        insertRevision(subject,id,revision,1,value,actor,time)
        return id to revision
    }
    internal fun createQuestion(subject: UUID,chapter: UUID,input: JsonNode,cmd: ContentCommand): MutationResult = mutate(subject,cmd) { s,row,time ->
        version(expected(input),s.descriptor.contentVersion);activeChapter(subject,chapter)
        val value=validation.payload(input["question"]["content"]);checkImages(subject,listOf(value))
        val (id,revision)=insertQuestion(subject,chapter,input["question"],value,s.context.actor.accountId,time)
        store.bump(subject,time);audit(s.context,row,cmd,AuditTarget.QUESTION,id,change(null,1)+AuditChange(AuditField.RESOURCE_STATUS,null,"ACTIVE"),time)
        receipt(cmd,subject,chapter,id,revision,version=1,contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    internal fun reviseQuestion(subject: UUID,question: UUID,input: JsonNode,cmd: ContentCommand,statusOnly: Boolean = false): MutationResult = mutate(subject,cmd) { s,row,time ->
        val old=store.question(subject,question);version(expected(input),old.num("version"));val v=next(old.num("version"))
        val previous=store.revision(question,old.id("current_revision_id"));var revision=previous.id
        val changes=mutableListOf<AuditChange>();var changed=false
        if(statusOnly) {
            val status=status(input["status"]);changed=status!=old.str("status")
            if(changed) { store.jdbc.update("UPDATE content_question SET status=?,version=? WHERE id=?",status,v,question);changes+=AuditChange(AuditField.RESOURCE_STATUS,old.str("status"),status) }
        } else {
            if(previous.revisionNumber==Int.MAX_VALUE)invalid("/content","CONTENT_LIMIT")
            val ids=store.jdbc.queryForList("SELECT id FROM content_option_identity WHERE question_id=?",UUID::class.java,question).toSet()
            val value=validation.payload(input["content"],ids);checkImages(subject,listOf(value))
            changed=previous.payload!=value.payload
            if(changed) {
                revision=UUID.randomUUID();insertRevision(subject,question,revision,previous.revisionNumber+1,value,s.context.actor.accountId,time)
                store.jdbc.update("UPDATE content_question SET current_revision_id=?,version=? WHERE id=?",revision,v,question)
            }
        }
        if(changed) { store.bump(subject,time);audit(s.context,row,cmd,AuditTarget.QUESTION,question,change(old.num("version"),v)+changes,time) }
        receipt(cmd,subject,old.id("chapter_id"),question,revision,version=if(changed)v else old.num("version"),contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    private fun importValidation(subject: UUID,documents: List<Row>): Pair<List<ImportIssue>,List<Triple<UUID,JsonNode,ValidatedPayload>>> {
        val issues=mutableListOf<ImportIssue>();val values=mutableListOf<Triple<UUID,JsonNode,ValidatedPayload>>();val sourceKeys=mutableSetOf<String>();val perChapter=mutableMapOf<UUID,Int>()
        for(doc in documents) {
            val ordinal=doc.num("ordinal").toInt();val chapter=doc.id("chapter_id");val questions=mapper.readTree(doc.str("payload"))
            val ch=store.row("SELECT * FROM content_chapter WHERE id=? AND subject_id=?",chapter,subject)
            if(ch==null || ch.str("status")!="ACTIVE")issues+=ImportIssue(ordinal,null,"/chapterId","CHAPTER_UNAVAILABLE",message="目标章节不可导入")
            perChapter[chapter]=(perChapter[chapter] ?: 0)+questions.size()
            questions.forEachIndexed { index,q ->
                try {
                    val source=validation.sourceKey(q)
                    if(source!=null && (!sourceKeys.add(source) || count("SELECT count(*) FROM content_question WHERE subject_id=? AND source_key=?",subject,source)>0))invalid("/sourceKey","IMPORT_SOURCE_CONFLICT")
                    val value=validation.payload(q["content"])
                    values+=Triple(chapter,q,value)
                } catch(e:ApiException) {
                    if(e.status!=HttpStatus.UNPROCESSABLE_ENTITY)throw e
                    issues+=ImportIssue(ordinal,index,"/questions/$index"+(e.fieldErrors.firstOrNull()?.field ?: ""),e.code,message="题目内容不符合导入要求")
                }
            }
        }
        for((chapter,added) in perChapter)if(count("SELECT count(*) FROM content_question WHERE chapter_id=?",chapter)+added>10000)issues+=ImportIssue(documents.first { it.id("chapter_id")==chapter }.num("ordinal").toInt(),null,"/questions","CONTENT_LIMIT",message="章节题目数量超过限制")
        if(issues.isEmpty())try { checkImages(subject,values.map { it.third }) } catch(e:ApiException) {
            if(e.status!=HttpStatus.UNPROCESSABLE_ENTITY)throw e
            issues+=ImportIssue(1,null,"/documents",e.code,message="图片引用不符合导入要求")
        }
        return issues to values
    }
    internal fun prevalidateImport(subject: UUID,input: JsonNode,cmd: ContentCommand): ImportView = root {
        val result=mutate(subject,cmd) { s,row,time ->
            version(expected(input),s.descriptor.contentVersion)
            val documents=input["documents"].mapIndexed { i,d -> mapOf<String,Any?>("ordinal" to i+1,"chapter_id" to d["chapterId"].uuid("/chapterId"),"payload" to mapper.writeValueAsString(d["questions"]),"file_name" to title(d["fileName"],"/fileName")) }
            val (issues,_)=importValidation(subject,documents)
            val id=UUID.randomUUID()
            store.jdbc.update("INSERT INTO content_import_batch(id,subject_id,created_by,state,subject_content_version,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",id,subject,s.context.actor.accountId,if(issues.isEmpty())"VALID" else "INVALID",s.descriptor.contentVersion,time.sql(),time.plusSeconds(86400).sql())
            for(doc in documents)store.jdbc.update("INSERT INTO content_import_document VALUES(?,?,?,?,?,?,?::jsonb)",UUID.randomUUID(),id,doc.num("ordinal").toInt(),doc.str("file_name"),"qanda-content-1",doc.id("chapter_id"),doc.str("payload"))
            for(issue in issues)store.jdbc.update("INSERT INTO content_import_issue VALUES(?,?,?,?,?,?,?,?)",UUID.randomUUID(),id,issue.documentOrdinal,issue.itemIndex,issue.pointer,issue.code,issue.severity,issue.message)
            receipt(cmd,subject,importId=id,version=1,contentVersion=s.descriptor.contentVersion,time=time)
        }
        store.importView(subject,result.importId!!,identity.currentActor().accountId)
    }
    fun getImport(subject: UUID,importId: UUID): ImportView = root {
        val ctx=subjectContext(subject,ContentView.MANAGE);store.importView(subject,importId,ctx.context.actor.accountId)
    }
    internal fun importAction(subject: UUID,importId: UUID,input: JsonNode,cmd: ContentCommand,commit: Boolean): MutationResult = mutate(subject,cmd) { s,row,time ->
        val old=store.importBatch(subject,importId,s.context.actor.accountId)
        if(old.str("state")=="COMMITTED")throw ApiException(HttpStatus.CONFLICT,"IMPORT_ALREADY_COMMITTED","批次已经提交")
        if(old.str("state")=="CANCELLED")throw ApiException(HttpStatus.CONFLICT,"IMPORT_CANCELLED","批次已经取消")
        version(expected(input),old.num("version"));val v=next(old.num("version"))
        if(commit) {
            if(old.str("state")!="VALID")invalid("/expectedVersion","IMPORT_INVALID")
            if(!old.time("expires_at").isAfter(time))throw ApiException(HttpStatus.CONFLICT,"IMPORT_EXPIRED","导入批次已过期")
            version(old.num("subject_content_version"),s.descriptor.contentVersion)
            val documents=store.jdbc.queryForList("SELECT ordinal,chapter_id,payload::text FROM content_import_document WHERE batch_id=? ORDER BY ordinal",importId)
            val (issues,values)=importValidation(subject,documents)
            if(issues.isNotEmpty())invalid(issues.first().pointer,issues.first().code,"导入条件已变化，请重新预检")
            values.forEachIndexed { i,(chapter,q,payload) ->
                val (id,revision)=insertQuestion(subject,chapter,q,payload,s.context.actor.accountId,time)
                store.jdbc.update("INSERT INTO content_import_created_question VALUES(?,?,?,?)",importId,i+1,id,revision)
            }
            store.bump(subject,time)
            store.jdbc.update("UPDATE content_import_batch SET state='COMMITTED',version=?,committed_at=? WHERE id=?",v,time.sql(),importId)
            audit(s.context,row,cmd,AuditTarget.IMPORT_BATCH,importId,change(old.num("version"),v),time,AuditAction.CONTENT_IMPORT_COMMITTED)
        } else store.jdbc.update("UPDATE content_import_batch SET state='CANCELLED',version=?,cancelled_at=? WHERE id=?",v,time.sql(),importId)
        receipt(cmd,subject,importId=importId,version=v,contentVersion=store.subject(subject).num("content_version"),time=time)
    }
    private fun lockImages(subject: UUID,ids: List<UUID>): List<FileReady> = files().lockReadyInTransaction(subject,ids).map { files().assertGuardInTransaction(it,subject) }
    private fun FileReady.view(subject: UUID)=ImageView(fileId,subject,mediaType,sizeBytes,widthPixels,heightPixels,readyAt)
    internal fun uploadImage(subject: UUID,cmd: ContentCommand): ImageView {
        val reserved=root {
            val s=subjectContext(subject,ContentView.MANAGE,true)
            commands.reserve(s.context.actor.accountId,cmd,subject,now(),true)
        }
        val actor=reserved.id("actor_account_id")
        // stage validates the original input mapping even on a READY retry and runs outside business locks.
        val ready=try {
            files().stage(reserved.id("upload_operation_id"),AssetActor(actor),ImageLimits(subject,cmd.mediaType,reserved.num("upload_profile_version").toInt()),cmd.bytes.inputStream())
        } catch(e:ApiException) {
            if(e.status.value() in 400..499 && e.code!="IDEMPOTENCY_CONFLICT")root {
                store.jdbc.update("UPDATE content_command_receipt SET state='REJECTED',rejection_code=?,rejection_status=? WHERE id=? AND state='RESERVED'",e.code,e.status.value(),reserved.id());Unit
            }
            throw e
        }
        return root {
            val s=subjectContext(subject,ContentView.MANAGE,true);val time=now();val row=commands.reserve(actor,cmd,subject,time,true)
            if(row.str("state")=="SUCCEEDED") {
                check(row.id("file_id")==ready.fileId)
                ready.view(subject)
            } else {
                guards.advanceLockPhaseInTransaction(35)
                val locked=lockImages(subject,listOf(ready.fileId)).singleOrNull() ?: unavailable()
                check(locked==ready)
                store.jdbc.update("INSERT INTO content_image VALUES(?,?,?) ON CONFLICT(file_id) DO NOTHING",ready.fileId,subject,time.sql())
                if(count("SELECT count(*) FROM content_image WHERE file_id=? AND subject_id=?",ready.fileId,subject)!=1L)unavailable()
                store.bump(subject,time)
                commands.complete(row,receipt(cmd,subject,file=ready.fileId,version=store.subject(subject).num("version"),contentVersion=store.subject(subject).num("content_version"),time=time))
                audit(s.context,row,cmd,AuditTarget.SUBJECT,subject,emptyList(),time)
                ready.view(subject)
            }
        }
    }
    fun readImage(subject: UUID,file: UUID,view: ContentView,revision: UUID?): Pair<FileReady,ByteArray> {
        val prepared=root {
            val s=subjectContext(subject,view)
            val context=ContentFileAccessContext(file,subject,s.context.actor,s.context.accounts,s.context.organizations,s.guard,s.verdict,s.context.admin,view,revision,now())
            guards.advanceLockPhaseInTransaction(35)
            files().prepareReadInTransaction(context)
        }
        return try {
            files().open(prepared).use { opened ->
                val bytes=opened.stream.readNBytes((opened.ready.sizeBytes+1).toInt())
                if(bytes.size.toLong()!=opened.ready.sizeBytes)unavailable()
                opened.ready to bytes
            }
        } catch(e:java.io.IOException) { unavailable() }
    }
    override fun lockSubjectsInTransaction(requests: List<SubjectLock>)=store.locks(requests)
    override fun describeLocked(guard: SubjectGuard)=store.describeLocked(guard)
    override fun resolveAccessibleQuestionRevisionsInTransaction(actor: AuthorizationActor,accounts: AuthorizationAccountGuards,organizations: OrganizationGuards,subjectGuard: SubjectGuard,accessVerdict: AccessVerdict,selection: ContentSelection): FixedContentSelection = tx.mandatory {
        subjectGuard.assertHeld();accounts.assertHeld(actor.accountId)
        val descriptor=store.describeLocked(subjectGuard)
        val fresh=authorization.evaluateLocked(actor,accounts,organizations,subjectGuard,descriptor,AccessAction.CREATE)
        check(fresh==accessVerdict && fresh.subjectId==selection.subjectId) { "Selection requires the current CREATE verdict" }
        requireAllowed(fresh)
        if(selection.chapterIds.size !in 1..100 || selection.chapterIds.distinct().size!=selection.chapterIds.size || selection.count !in 1..100)invalid("/scope")
        if(selection.questionIds!=null && (selection.questionIds.size !in 1..100 || selection.questionIds.distinct().size!=selection.questionIds.size))invalid("/scope/questionIds")
        selection.chapterIds.forEach { activeChapter(selection.subjectId,it) }
        val binds=selection.chapterIds.joinToString(",") { "?" }
        var sql=store.questionsSql+" WHERE q.subject_id=? AND q.chapter_id IN ($binds) AND q.status='ACTIVE' AND c.status='ACTIVE'"
        val args=mutableListOf<Any?>(selection.subjectId).apply { addAll(selection.chapterIds) }
        selection.questionIds?.let { ids -> sql+=" AND q.id IN (${ids.joinToString(",") { "?" }})";args.addAll(ids) }
        sql+=" ORDER BY "+if(selection.order==QuestionOrder.RANDOM)"random()" else "c.position,q.position,q.id"
        val selected=store.jdbc.query(sql+" LIMIT ?",store.questionMapper,*(args+selection.count).toTypedArray())
        if(selected.size!=selection.count || (selection.questionIds!=null && selected.map { it.id }.toSet()!=selection.questionIds.toSet()))invalid("/scope/count","INSUFFICIENT_QUESTIONS")
        val fileIds=store.jdbc.queryForList("SELECT DISTINCT file_id FROM content_revision_attachment WHERE revision_id IN (${selected.joinToString(",") { "?" }}) ORDER BY file_id",UUID::class.java,*selected.map { it.revisionId }.toTypedArray())
        val images=if(fileIds.isEmpty())emptyList() else {
            guards.advanceLockPhaseInTransaction(35)
            lockImages(selection.subjectId,fileIds).also { if(it.map { image -> image.fileId }.toSet()!=fileIds.toSet())unavailable() }
        }
        val subject=store.subject(selection.subjectId)
        FixedContentSelection(selection.subjectId,descriptor.source,subject.str("title"),descriptor.ownerAccountId,descriptor.contentVersion,selection.chapterIds.map { val c=store.chapter(selection.subjectId,it);FixedChapter(it,c.str("title")) },selected.map { FixedQuestion(it.id,it.chapterId,it.revisionId,it.revisionNumber,it.payload) },images.map { AttachmentManifest(it.fileId,it.mediaType,it.sizeBytes,it.sha256,it.widthPixels,it.heightPixels) })
    }
    override fun readIssuedRevisionsInTransaction(subjectGuard: SubjectGuard,accessVerdict: AccessVerdict,issuedReferences: List<IssuedRevisionReference>): List<FixedQuestion> = tx.mandatory {
        subjectGuard.assertHeld();val d=store.describeLocked(subjectGuard)
        check(accessVerdict.subjectId==d.id && accessVerdict.contentVersion==d.contentVersion && accessVerdict.action in setOf(AccessAction.CONTINUE_FIXED_SESSION,AccessAction.READ_FIXED_SESSION_RESULT) && accessVerdict.allowed)
        check(issuedReferences.size in 1..100 && issuedReferences.distinct().size==issuedReferences.size)
        val args=mutableListOf<Any?>(d.id)
        val predicates=issuedReferences.map { args+=it.questionId;args+=it.revisionId;"(q.id=? AND r.id=?)" }
        val rows=store.jdbc.query("""SELECT q.id,q.chapter_id,r.id revision_id,r.revision_number,r.payload FROM content_question q JOIN content_question_revision r ON r.question_id=q.id WHERE q.subject_id=? AND (${predicates.joinToString(" OR ")})""",RowMapper { r,_ -> FixedQuestion(r.id(),r.id("chapter_id"),r.id("revision_id"),r.getInt("revision_number"),mapper.readTree(r.getString("payload"))) },*args.toTypedArray())
        if(rows.size!=issuedReferences.size)unavailable()
        val attachments=store.jdbc.queryForList("SELECT DISTINCT file_id FROM content_revision_attachment WHERE revision_id IN (${rows.joinToString(",") { "?" }})",UUID::class.java,*rows.map { it.revisionId }.toTypedArray())
        if(attachments.isNotEmpty() && store.readReadyAttachmentMetadata(attachments,subjectGuard).map { it.fileId }.toSet()!=attachments.toSet())unavailable()
        val indexed=rows.associateBy { IssuedRevisionReference(it.questionId,it.revisionId) }
        issuedReferences.map { indexed.getValue(it) }
    }
    override fun currentQuestionScopeForQuery(subjectGuards: List<SubjectGuard>,accessVerdicts: List<AccessVerdict>,chapterIds: List<UUID>?): CurrentQuestionScope = tx.mandatory {
        check(subjectGuards.size in 1..100 && subjectGuards.map { it.subjectId }.distinct().size==subjectGuards.size && accessVerdicts.size==subjectGuards.size)
        val ids=subjectGuards.map { g ->
            val d=store.describeLocked(g);val v=accessVerdicts.single { it.subjectId==d.id }
            check(v.contentVersion==d.contentVersion && v.action in setOf(AccessAction.SELECT_WRONG_REVIEW,AccessAction.READ_LEARNING_HISTORY) && v.allowed)
            d.id
        }
        if(chapterIds!=null && (chapterIds.size !in 1..100 || chapterIds.distinct().size!=chapterIds.size))invalid("/chapterIds")
        val sql="""SELECT q.id question_id,q.subject_id,q.chapter_id,q.current_revision_id,r.payload->>'type' question_type,
            (s.status='ACTIVE' AND c.status='ACTIVE' AND q.status='ACTIVE') active_for_new_selection
            FROM content_question q JOIN content_subject s ON s.id=q.subject_id JOIN content_chapter c ON c.id=q.chapter_id JOIN content_question_revision r ON r.id=q.current_revision_id
            WHERE q.subject_id IN (${ids.joinToString(",") { "?" }})"""+(if(chapterIds!=null)" AND q.chapter_id IN (${chapterIds.joinToString(",") { "?" }})" else "")
        CurrentQuestionScope(sql,ids+chapterIds.orEmpty()) { subjectGuards.forEach { it.assertHeld() } }
    }
}
