package qanda.backend.practice

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.content.*
import qanda.backend.platform.http.*
import qanda.backend.platform.persistence.SystemMapper
import qanda.backend.platform.security.Actor
import java.time.Clock
import java.time.Duration
import java.util.UUID

@Service
@Transactional
class PracticeService(private val rows: PracticeSessionMapper,private val itemRows: PracticeItemMapper,private val results: PracticeResultMapper,
                      private val questions: QuestionMapper,private val chapters: ChapterMapper,private val content: ContentService,private val access: ContentAccess,
                      private val sql: PracticeQueries,private val contentSql: ContentQueries,private val system: SystemMapper,private val clock: Clock,private val json: ObjectMapper) {
    private fun validateScope(actor: Actor,scope: ScopeInput): QuestionBank {
        if(scope.count !in 1..1000 || scope.order !in setOf("SEQUENTIAL","RANDOM") || scope.selectionKind !in setOf("NORMAL","WRONG","FAVORITE")) invalid("/scope")
        val bank=access.bank(actor,scope.questionBankId)
        if(scope.chapterIds.size>100 || scope.chapterIds.distinct().size!=scope.chapterIds.size) invalid("/scope/chapterIds")
        scope.chapterIds.forEach { if(chapters.selectById(it)?.bankId!=scope.questionBankId) invalid("/scope/chapterIds") }
        if(scope.questionIds.size>1000 || scope.questionIds.distinct().size!=scope.questionIds.size) invalid("/scope/questionIds")
        if(scope.questionIds.isNotEmpty() && sql.eligibleCount(actor.id,scope)!=scope.questionIds.size.toLong()) invalid("/scope/questionIds","QUESTION_SCOPE_MISMATCH","所选题目不属于当前可练习范围")
        return bank
    }
    fun preview(actor: Actor,scope: ScopeInput): ScopeView { val bank=validateScope(actor,scope);return ScopeView(sql.eligibleCount(actor.id,scope),bank.contentVersion) }
    fun create(actor: Actor,input: CreatePracticeInput): PracticeView {
        val bank=validateScope(actor,input.scope)
        system.lock("practice:${actor.id}:${bank.id}")
        // All content writes hold the bank row, so selection and revision pinning share one boundary.
        val locked=contentSql.lockBank(bank.id!!) ?: missing()
        access.bank(actor,bank.id!!)
        requireVersion(input.expectedContentVersion,locked.contentVersion)
        if(input.feedback !in setOf("IMMEDIATE","AFTER_FINISH")) invalid("/feedback")
        if(sql.eligibleCount(actor.id,input.scope)<input.scope.count) invalid("/scope/count","INSUFFICIENT_QUESTIONS","符合条件的题目数量不足")
        val chosen=sql.eligible(actor.id,input.scope)
        val session=PracticeSession().apply { id=UUID.randomUUID();userId=actor.id;bankId=bank.id;clientType=actor.clientType;selectionKind=input.scope.selectionKind;questionOrder=input.scope.order;feedback=input.feedback;createdAt=clock.instant();updatedAt=createdAt }
        session.configurationSnapshot=json.writeValueAsString(PracticeConfiguration(input.scope.chapterIds,input.scope.count,input.scope.order,input.scope.selectionKind,input.feedback,locked.contentVersion,input.scope.questionIds))
        input.deviceId?.let { session.writerEnabled=true;session.writerDeviceId=it;session.writerToken=UUID.randomUUID() }
        rows.insert(session)
        chosen.forEachIndexed { i,q -> itemRows.insert(PracticeItem().apply { id=UUID.randomUUID();sessionId=session.id;questionId=q.id;revisionId=q.currentRevisionId;position=i }) }
        system.activity(actor.id,actor.clientType)
        return view(session,input.deviceId,input.deviceId!=null)
    }
    private fun owned(userId: UUID,id: UUID,lock: Boolean=false): PracticeSession {
        val row=(if(lock) sql.lockSession(id) else rows.selectById(id)) ?: missing();if(row.userId!=userId) missing();return row
    }
    private fun answer(item: PracticeItem): AnswerInput? {
        val choices=sql.choices(item.id!!)
        return when { choices.isNotEmpty() -> AnswerInput(optionKeys=choices);item.answerBoolean!=null -> AnswerInput(value=item.answerBoolean);item.answerText!=null -> AnswerInput(text=item.answerText);else -> null }
    }
    private fun views(session: PracticeSession): List<PracticeItemView> = sql.items(session.id!!).map { item ->
        val reveal=session.status=="SUBMITTED" || session.feedback=="IMMEDIATE" && item.confirmed
        val question=questions.selectById(item.questionId) ?: missing()
        PracticeItemView(item.id!!,item.position,content.questionView(question,item.revisionId!!,reveal),answer(item),item.confirmed,item.marked,item.outcome.takeIf { reveal },item.selfAssessment.takeIf { reveal })
    }
    private fun writerView(row: PracticeSession,deviceId: UUID?): WriterView? = if(!row.writerEnabled) null else WriterView(
        if(row.writerDeviceId==null) "RELEASED" else if(row.writerDeviceId==deviceId) "ACTIVE" else "WAITING",
        row.writerDeviceId,row.writerToken.takeIf { deviceId!=null && row.writerDeviceId==deviceId },row.pendingWriterDeviceId,row.version,row.acknowledgedSequence,row.updatedAt)
    private fun view(row: PracticeSession,deviceId: UUID?=null,offline: Boolean=false): PracticeView {
        val grading=if(offline) sql.items(row.id!!).map { item ->
            val q=content.questionView(questions.selectById(item.questionId),item.revisionId!!,true)
            OfflineGrading(item.id!!,q.correctAnswer,q.correctValue,q.referenceAnswer,q.explanation)
        } else null
        return PracticeView(row.id!!,row.bankId!!,row.status,row.version,row.currentIndex,row.durationSeconds,row.feedback,views(row),row.createdAt,
            row.configurationSnapshot?.let { json.readValue(it,PracticeConfiguration::class.java) },grading,writerView(row,deviceId))
    }
    fun read(userId: UUID,id: UUID): PracticeView = view(owned(userId,id))
    private fun writer(row: PracticeSession,token: UUID?) {
        if(row.writerEnabled && (token==null || row.writerToken!=token)) conflict("WRITER_REVOKED","当前设备已停止编辑，请同步后重新进入练习")
    }
    fun snapshot(actor: Actor,id: UUID,deviceId: UUID,token: UUID): PracticeView {
        val row=owned(actor.id,id);writer(row,token)
        if(!row.writerEnabled || row.writerDeviceId!=deviceId) conflict("WRITER_REQUIRED","请先获取练习编辑权")
        return view(row,deviceId,true)
    }
    private fun saveProgress(actor: Actor,id: UUID,input: ProgressInput): PracticeSession {
        val row=owned(actor.id,id,true);writer(row,input.writerToken);requireVersion(input.expectedVersion,row.version)
        if(row.status!="IN_PROGRESS") conflict("SESSION_CLOSED","练习已结束")
        if(row.writerEnabled && (input.clientSequence==null || input.clientSequence<=row.acknowledgedSequence)) invalid("/clientSequence")
        val items=sql.items(id)
        if(input.currentIndex !in items.indices) invalid("/currentIndex")
        duration(row,input.durationSeconds)
        applyAnswers(row,items,input.items)
        row.currentIndex=input.currentIndex;row.durationSeconds=input.durationSeconds;row.version++;row.updatedAt=clock.instant()
        input.clientSequence?.let { if(it<0) invalid("/clientSequence");row.acknowledgedSequence=it }
        rows.updateById(row);system.activity(actor.id,actor.clientType)
        return row
    }
    fun progress(actor: Actor,id: UUID,input: ProgressInput): PracticeView = view(saveProgress(actor,id,input))
    fun progressAck(actor: Actor,id: UUID,input: ProgressInput): ProgressAck {
        val row=saveProgress(actor,id,input)
        return ProgressAck(id,row.version,row.acknowledgedSequence,writerView(row,row.writerDeviceId))
    }
    fun acquireWriter(actor: Actor,id: UUID,input: WriterInput): WriterView {
        val row=owned(actor.id,id,true)
        if(row.status!="IN_PROGRESS") conflict("SESSION_CLOSED","练习已结束")
        if(!row.writerEnabled || row.writerDeviceId==null) {
            row.writerEnabled=true;row.writerDeviceId=input.deviceId;row.writerToken=UUID.randomUUID();row.acknowledgedSequence=0
        } else if(row.writerDeviceId!=input.deviceId) {
            if(row.pendingWriterDeviceId!=null && row.pendingWriterDeviceId!=input.deviceId) conflict("TAKEOVER_PENDING","已有设备正在等待同步")
            row.pendingWriterDeviceId=input.deviceId
        }
        row.updatedAt=clock.instant();rows.updateById(row)
        return writerView(row,input.deviceId)!!
    }
    fun writerState(actor: Actor,id: UUID,deviceId: UUID): WriterView {
        val row=owned(actor.id,id)
        return writerView(row,deviceId) ?: WriterView("RELEASED",null,null,null,row.version,0,row.updatedAt)
    }
    fun releaseWriter(actor: Actor,id: UUID,input: WriterReleaseInput): WriterView {
        val row=owned(actor.id,id,true);writer(row,input.writerToken);requireVersion(input.expectedVersion,row.version)
        if(!row.writerEnabled || row.writerDeviceId!=input.deviceId) conflict("WRITER_REVOKED","当前设备已停止编辑")
        if(input.clientSequence!=row.acknowledgedSequence) conflict("SYNC_REQUIRED","请完成最后一次进度同步")
        row.writerDeviceId=row.pendingWriterDeviceId;row.writerToken=row.writerDeviceId?.let { UUID.randomUUID() }
        row.pendingWriterDeviceId=null;row.acknowledgedSequence=0;row.updatedAt=clock.instant();rows.updateById(row)
        return writerView(row,input.deviceId)!!
    }
    private fun duration(row: PracticeSession,value: Int) {
        if(value<row.durationSeconds || value.toLong()>Duration.between(row.createdAt,clock.instant()).seconds.coerceAtLeast(0)+5) invalid("/durationSeconds")
    }
    private fun applyAnswers(row: PracticeSession,items: List<PracticeItem>,changes: List<ItemProgress>) {
        if(changes.size>items.size || changes.map { it.itemId }.distinct().size!=changes.size) invalid("/items")
        val byId=items.associateBy { it.id }
        changes.forEach { change ->
            val item=byId[change.itemId] ?: invalid("/items/itemId")
            val normalized=change.answer?.let { it.copy(optionKeys=it.optionKeys?.sorted()) }
            val question=content.questionView(questions.selectById(item.questionId),item.revisionId!!,true)
            Grading.validate(question,normalized)
            val previous=answer(item)
            if(row.feedback=="IMMEDIATE" && item.confirmed && (normalized!=previous || !change.confirmed)) conflict("ANSWER_CONFIRMED","已确认的答案不能修改")
            if(change.confirmed && normalized==null) invalid("/items/confirmed")
            if(normalized==previous && change.confirmed==item.confirmed && change.marked==item.marked) return@forEach
            item.answerText=normalized?.text;item.answerBoolean=normalized?.value;item.confirmed=change.confirmed;item.marked=change.marked
            item.outcome=if(row.feedback=="IMMEDIATE" && change.confirmed) Grading.outcome(question,normalized) else null
            sql.clearChoices(item.id!!);normalized?.optionKeys?.forEach { sql.addChoice(item.id!!,item.revisionId!!,it) };sql.updateAnswer(item)
        }
    }
    fun finish(actor: Actor,id: UUID,input: FinishInput): ResultView {
        val row=owned(actor.id,id,true)
        if(row.status=="SUBMITTED") return result(actor.id,id)
        writer(row,input.writerToken);requireVersion(input.expectedVersion,row.version);if(row.status!="IN_PROGRESS") conflict("SESSION_CLOSED","练习已结束")
        duration(row,input.durationSeconds);val items=sql.items(id);applyAnswers(row,items,input.items)
        val finalItems=sql.items(id)
        finalItems.forEach { item ->
            val question=content.questionView(questions.selectById(item.questionId),item.revisionId!!,true)
            val submitted=answer(item).takeIf { question.type!="MULTIPLE_CHOICE" || item.confirmed }
            item.outcome=Grading.outcome(question,submitted);sql.updateAnswer(item)
        }
        val short=finalItems.filter { questions.selectById(it.questionId).let { q -> content.questionView(q,it.revisionId!!,false).type=="SHORT_ANSWER" } }
        val objective=finalItems-short.toSet()
        val result=PracticeResult().apply { this.id=UUID.randomUUID();sessionId=id;totalCount=finalItems.size;objectiveCount=objective.size;shortAnswerCount=short.size
            correctCount=objective.count { it.outcome=="CORRECT" };wrongCount=objective.count { it.outcome=="WRONG" };unansweredCount=objectiveCount-correctCount-wrongCount
            answeredCount=finalItems.count { it.outcome!="UNANSWERED" };durationSeconds=input.durationSeconds;createdAt=clock.instant() }
        results.insert(result);row.status="SUBMITTED";row.submittedAt=clock.instant();row.updatedAt=row.submittedAt!!;row.durationSeconds=input.durationSeconds;row.version++;rows.updateById(row)
        system.activity(actor.id,actor.clientType);return result(actor.id,id)
    }
    fun result(userId: UUID,id: UUID): ResultView {
        val session=owned(userId,id);if(session.status!="SUBMITTED") conflict("RESULT_NOT_READY","练习尚未交卷")
        val result=sql.result(id) ?: missing();val items=views(session);val short=items.filter { it.question.type=="SHORT_ANSWER" }
        val rated=short.count { it.selfAssessment!=null };val answered=short.count { it.answer!=null };val objectiveAnswered=result.correctCount+result.wrongCount
        return ResultView(result.id!!,id,session.version,result.totalCount,result.answeredCount,result.durationSeconds,
            ObjectiveMetrics(result.objectiveCount,objectiveAnswered,result.correctCount,result.wrongCount,result.unansweredCount,if(objectiveAnswered==0) 0.0 else result.correctCount.toDouble()/objectiveAnswered),
            SelfMetrics(short.size,answered,rated,short.count { it.selfAssessment=="CORRECT" },short.count { it.selfAssessment=="WRONG" },short.size-rated),items,session.submittedAt!!)
    }
    fun assess(actor: Actor,id: UUID,itemId: UUID,input: SelfAssessmentInput): ResultView {
        val row=owned(actor.id,id,true);requireVersion(input.expectedVersion,row.version)
        if(row.status!="SUBMITTED" || input.assessment !in setOf("CORRECT","WRONG")) invalid("/assessment")
        val item=sql.items(id).firstOrNull { it.id==itemId } ?: missing()
        if(item.outcome!="SELF_RATED") invalid("/assessment","SELF_ASSESSMENT_UNAVAILABLE","只有已作答的简答题可以自评")
        item.selfAssessment=input.assessment;sql.updateAnswer(item);row.version++;row.updatedAt=clock.instant();rows.updateById(row);return result(actor.id,id)
    }
    fun cancel(actor: Actor,id: UUID,input: ExpectedVersionInput): MutationResult {
        val row=owned(actor.id,id,true);writer(row,input.writerToken);requireVersion(input.expectedVersion,row.version);if(row.status!="IN_PROGRESS") conflict("SESSION_CLOSED","练习已结束")
        row.status="CANCELLED";row.version++;row.updatedAt=clock.instant();rows.updateById(row);return MutationResult(id,row.version)
    }
    fun history(userId: UUID,p: PageSpec,completedOnly: Boolean): Page<PracticeSummary> = Page(sql.history(userId,completedOnly,p.offset,p.pageSize).map { PracticeSummary(it.id!!,it.bankId!!,it.status,it.version,it.durationSeconds,it.createdAt,it.submittedAt) },sql.historyCount(userId,completedOnly),p.page,p.pageSize)
}
