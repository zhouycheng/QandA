package qanda.backend.content

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.admin.AdminAccountMapper
import qanda.backend.catalog.*
import qanda.backend.platform.files.FileAssetMapper
import qanda.backend.platform.http.*
import qanda.backend.platform.security.Actor
import java.time.Instant
import java.util.UUID

@Service
@Transactional
class ContentService(private val banks: QuestionBankMapper,private val chapters: ChapterMapper,private val questions: QuestionMapper,
                     private val revisions: QuestionRevisionMapper,private val audiences: BankAudienceMapper,private val files: FileAssetMapper,
                     private val admins: AdminAccountMapper,private val colleges: CollegeMapper,private val majors: MajorMapper,private val subjects: SubjectMapper,
                     private val sql: ContentQueries,private val access: ContentAccess) {
    fun bankView(row: QuestionBank,admin: Boolean): BankView = bankViews(listOf(row),admin).first()
    private fun bankViews(rows: List<QuestionBank>,admin: Boolean,userId: UUID?=null): List<BankView> {
        if(rows.isEmpty()) return emptyList()
        val ids=rows.map { it.id!! };val facts=sql.bankListFacts(ids,userId).associateBy { it.bankId }
        val audienceRows=sql.bankAudiences(ids).groupBy { it.bankId }
        val maintainers=if(admin) sql.bankMaintainers(ids).groupBy { it.bankId } else emptyMap()
        return rows.map { row -> val f=facts.getValue(row.id)
            BankView(row.id!!,row.subjectId!!,row.name,row.description,row.textbook,row.status,row.publicationStatus,row.scopeType,
                audienceRows[row.id].orEmpty().map { AudienceInput(it.collegeId,it.majorId,it.enrollmentYear) },
                maintainers[row.id].orEmpty().map { it.adminId!! },row.version,row.contentVersion,if(admin) f.questionCount else f.activeQuestionCount,f.activeQuestionCount,row.updatedAt,f.subjectName,
                userId?.let { BankProgressView(f.answeredCount,f.correctCount,f.wrongCount) })
        }
    }
    fun banks(actor: Actor?,subjectId: UUID?,keyword: String?,p: PageSpec,includeProgress: Boolean=false): Page<BankView> {
        val publicOnly=actor?.kind!="ADMIN";val adminId=actor?.takeIf { it.kind=="ADMIN" && it.role!="PLATFORM_ADMIN" }?.id
        return Page(bankViews(sql.banks(subjectId,keyword,publicOnly,adminId,p.offset,p.pageSize),!publicOnly,actor?.id?.takeIf { publicOnly && includeProgress }),sql.bankCount(subjectId,keyword,publicOnly,adminId),p.page,p.pageSize)
    }
    fun bank(actor: Actor?,id: UUID)=bankView(access.bank(actor,id),actor?.kind=="ADMIN")
    fun saveBank(actor: Actor,id: UUID?,input: BankInput): MutationResult {
        if(id==null && actor.role!="PLATFORM_ADMIN") forbidden()
        val row=id?.let { access.bank(actor,it,true) } ?: QuestionBank().apply { this.id=UUID.randomUUID();createdBy=actor.id;subjectId=input.subjectId }
        if(id!=null) { requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version);if(row.subjectId!=input.subjectId) invalid("/subjectId","IMMUTABLE_PARENT","题库所属课程不可变更") }
        if(subjects.selectById(input.subjectId)==null) invalid("/subjectId")
        if(input.scopeType !in setOf("ALL","TARGETED") || input.audiences.size>100) invalid("/scopeType")
        if(input.scopeType=="ALL" && input.audiences.isNotEmpty() || input.scopeType=="TARGETED" && input.audiences.isEmpty()) invalid("/audiences")
        val normalized=input.audiences.map { normalizeAudience(it) }
        if(normalized.distinct().size!=normalized.size) invalid("/audiences")
        input.maintainerIds?.let { ids ->
            if(actor.role!="PLATFORM_ADMIN" && ids.sorted()!=sql.maintainers(row.id!!).sorted()) forbidden()
            if(ids.size>100 || ids.distinct().size!=ids.size) invalid("/maintainerIds")
            ids.forEach { if(admins.selectById(it)?.status!="ACTIVE") invalid("/maintainerIds") }
        }
        row.name=name(input.name);row.description=text(input.description,2000);row.textbook=text(input.textbook,500);row.status=activeStatus(input.status);row.scopeType=input.scopeType;row.updatedAt=Instant.now()
        if(id==null) banks.insert(row) else { row.version++;banks.updateById(row) }
        sql.clearAudiences(row.id!!);normalized.forEach { audiences.insert(BankAudience().apply { this.id=UUID.randomUUID();bankId=row.id;collegeId=it.collegeId;majorId=it.majorId;enrollmentYear=it.enrollmentYear }) }
        if(actor.role=="PLATFORM_ADMIN" && input.maintainerIds!=null) { sql.clearMaintainers(row.id!!);input.maintainerIds.forEach { sql.addMaintainer(row.id!!,it) } }
        return MutationResult(row.id!!,row.version)
    }
    private fun normalizeAudience(input: AudienceInput): AudienceInput {
        val major=input.majorId?.let { majors.selectById(it) ?: invalid("/audiences/majorId") }
        if(major!=null && input.collegeId!=null && major.collegeId!=input.collegeId) invalid("/audiences/collegeId")
        if(input.collegeId!=null && colleges.selectById(input.collegeId)==null || major==null && input.collegeId==null && input.enrollmentYear==null) invalid("/audiences")
        if(input.enrollmentYear!=null && input.enrollmentYear !in 1900..2200) invalid("/audiences/enrollmentYear")
        return input.copy(collegeId=if(major==null) input.collegeId else null)
    }
    fun chapters(actor: Actor?,bankId: UUID): List<ChapterView> {
        access.bank(actor,bankId)
        return chapters.selectList(QueryWrapper<Chapter>().eq("bank_id",bankId).orderByAsc("sort_order")).map { ChapterView(it.id!!,bankId,it.name,it.sortOrder,it.version) }
    }
    fun saveChapter(actor: Actor,bankId: UUID,id: UUID?,input: ChapterInput): MutationResult {
        access.bank(actor,bankId,true)
        if(input.sortOrder !in 0..10000) invalid("/sortOrder")
        val row=id?.let { chapters.selectById(it) ?: missing() } ?: Chapter().apply { this.id=UUID.randomUUID();this.bankId=bankId }
        if(row.bankId!=bankId) missing()
        if(id!=null) requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version)
        row.name=name(input.name);row.sortOrder=input.sortOrder
        if(id==null) chapters.insert(row) else { row.version++;chapters.updateById(row) };sql.bumpBank(bankId)
        return MutationResult(row.id!!,row.version)
    }
    fun deleteChapter(actor: Actor,bankId: UUID,id: UUID,expectedVersion: Long): MutationResult {
        access.bank(actor,bankId,true);val row=chapters.selectById(id) ?: missing();if(row.bankId!=bankId) missing();requireVersion(expectedVersion,row.version)
        if(sql.chapterQuestions(id)>0) conflict("CHAPTER_NOT_EMPTY","请先将题目移出章节")
        chapters.deleteById(id);sql.bumpBank(bankId);return MutationResult(id,row.version)
    }
    fun reorder(actor: Actor,bankId: UUID,input: ReorderInput): MutationResult {
        val bank=access.bank(actor,bankId,true);requireVersion(input.expectedContentVersion,bank.contentVersion)
        val rows=chapters.selectList(QueryWrapper<Chapter>().eq("bank_id",bankId))
        if(input.ids.size!=rows.size || input.ids.toSet()!=rows.map { it.id }.toSet()) invalid("/ids")
        input.ids.forEachIndexed { i,id -> val row=rows.first { it.id==id };row.sortOrder=i;row.version++;chapters.updateById(row) }
        sql.bumpBank(bankId);return MutationResult(bankId,bank.version+1)
    }
    fun publish(actor: Actor,id: UUID,input: PublicationInput): MutationResult {
        val row=access.bank(actor,id,true);requireVersion(input.expectedVersion,row.version)
        if(input.status !in setOf("DRAFT","PUBLISHED","UNPUBLISHED","ARCHIVED")) invalid("/status")
        if(input.status=="PUBLISHED") {
            if(row.status!="ACTIVE" || subjects.selectById(row.subjectId)?.status!="ACTIVE" || sql.questionCount(id,true)==0L) invalid("/status","PUBLISH_VALIDATION_FAILED","发布需要启用的课程、题库及可练习题目")
            if(row.scopeType=="TARGETED" && audiences.selectCount(QueryWrapper<BankAudience>().eq("bank_id",id))==0L) invalid("/audiences")
        }
        row.publicationStatus=input.status;row.version++;row.updatedAt=Instant.now();banks.updateById(row);return MutationResult(id,row.version)
    }
    fun validate(input: QuestionInput) {
        activeStatus(input.status);if(input.stem.isBlank()) invalid("/stem");safeText(input.stem,10000);safeText(input.explanation,10000)
        if(input.chapterId!=null && chapters.selectById(input.chapterId)?.bankId!=input.questionBankId) invalid("/chapterId","CHAPTER_BANK_MISMATCH","章节不属于题库")
        if(input.assetIds.size>20 || input.assetIds.distinct().size!=input.assetIds.size) invalid("/assetIds")
        input.assetIds.forEach { if(files.selectById(it)?.bankId!=input.questionBankId) invalid("/assetIds") }
        when(input.type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> {
                if(input.options.size !in 2..26 || input.options.map { it.key }.distinct().size!=input.options.size) invalid("/options")
                input.options.forEach { if(!it.key.matches(Regex("[A-Z0-9]{1,8}")) || it.content.isBlank()) invalid("/options");safeText(it.content,4000) }
                if(input.correctAnswer.isEmpty() || input.correctAnswer.distinct().size!=input.correctAnswer.size || input.correctAnswer.any { a -> input.options.none { it.key==a } }) invalid("/correctAnswer")
                if(input.type=="SINGLE_CHOICE" && input.correctAnswer.size!=1 || input.type=="MULTIPLE_CHOICE" && input.correctAnswer.size<2 || input.correctValue!=null || input.referenceAnswer!=null) invalid("/correctAnswer")
            }
            "TRUE_FALSE" -> if(input.correctValue==null || input.options.isNotEmpty() || input.correctAnswer.isNotEmpty() || input.referenceAnswer!=null) invalid("/correctValue")
            "SHORT_ANSWER" -> { if(input.referenceAnswer.isNullOrBlank() || input.options.isNotEmpty() || input.correctAnswer.isNotEmpty() || input.correctValue!=null) invalid("/referenceAnswer");safeText(input.referenceAnswer,10000) }
            else -> invalid("/type")
        }
    }
    private fun safeText(value: String,maximum: Int) { text(value,maximum);RestrictedMarkdown.validate(value,"/content") }
    fun questionView(question: Question,revisionId: UUID=question.currentRevisionId!!,answers: Boolean=false): QuestionView {
        val revision=revisions.selectById(revisionId) ?: missing();if(revision.questionId!=question.id) missing();val options=sql.options(revisionId)
        return QuestionView(question.id!!,question.bankId!!,question.chapterId,question.status,question.version,revision.id!!,revision.revisionNumber,revision.type,revision.stem,
            options.map { OptionInput(it.optionKey,it.content) },if(answers) options.filter { it.isCorrect }.map { it.optionKey } else null,
            revision.correctValue.takeIf { answers },revision.referenceAnswer.takeIf { answers },revision.explanation.takeIf { answers },sql.attachments(revisionId))
    }
    fun question(actor: Actor?,id: UUID): QuestionView {
        val row=questions.selectById(id) ?: missing();access.bank(actor,row.bankId!!);if(actor?.kind!="ADMIN" && row.status!="ACTIVE") missing()
        return questionView(row,answers=actor?.kind=="ADMIN")
    }
    fun search(actor: Actor?,keyword: String,p: PageSpec,view: String="full"): Page<QuestionView> {
        if(actor!=null && actor.kind!="USER") forbidden()
        val query=keyword.trim()
        if(query.isEmpty() || query.length>200 || '\u0000' in query) invalid("/keyword")
        return Page(listQuestions(sql.search(query,p.offset,p.pageSize),false,view),sql.searchCount(query),p.page,p.pageSize)
    }
    fun questions(actor: Actor?,bankId: UUID,chapterId: UUID?,keyword: String?,p: PageSpec,view: String="full"): Page<QuestionView> {
        access.bank(actor,bankId);val activeOnly=actor?.kind!="ADMIN"
        return Page(listQuestions(sql.questions(bankId,chapterId,keyword,activeOnly,p.offset,p.pageSize),!activeOnly,view),sql.filteredQuestionCount(bankId,chapterId,keyword,activeOnly),p.page,p.pageSize)
    }
    private fun listQuestions(rows: List<Question>,answers: Boolean,view: String): List<QuestionView> {
        if(view !in setOf("full","summary")) invalid("/view")
        if(view=="full") return rows.map { questionView(it,answers=answers) }
        if(rows.isEmpty()) return emptyList()
        val summaries=sql.questionSummaries(rows.map { it.id!! }).associateBy { it.id }
        return rows.map { row -> val q=summaries.getValue(row.id)
            QuestionView(q.id!!,q.bankId!!,q.chapterId,q.status,q.version,q.revisionId!!,q.revision,q.type,q.stem,emptyList(),null,null,null,null,emptyList(),q.subjectId,q.subjectName,q.bankName)
        }
    }
    fun saveQuestion(actor: Actor,id: UUID?,input: QuestionInput): MutationResult {
        access.bank(actor,input.questionBankId,true);validate(input)
        val row=id?.let { questions.selectById(it) ?: missing() } ?: Question().apply { this.id=UUID.randomUUID();bankId=input.questionBankId }
        if(row.bankId!=input.questionBankId) invalid("/questionBankId","IMMUTABLE_PARENT","题目所属题库不可变更")
        if(id!=null) requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version)
        val revision=QuestionRevision().apply { this.id=UUID.randomUUID();questionId=row.id;revisionNumber=if(id==null) 1 else revisions.selectById(row.currentRevisionId).revisionNumber+1
            type=input.type;stem=input.stem;explanation=input.explanation;correctValue=input.correctValue;referenceAnswer=input.referenceAnswer;createdBy=actor.id }
        if(id==null) { row.chapterId=input.chapterId;row.status=input.status;row.currentRevisionId=revision.id;questions.insert(row) }
        revisions.insert(revision)
        input.options.forEachIndexed { i,option -> sql.insertOption(QuestionOption().apply { revisionId=revision.id;optionKey=option.key;content=option.content;isCorrect=option.key in input.correctAnswer;sortOrder=i }) }
        input.assetIds.forEach { sql.attach(revision.id!!,it) }
        if(id!=null) { sql.updateQuestion(id,input.chapterId,input.status,revision.id!!);row.version++ }
        sql.bumpBank(input.questionBankId)
        return MutationResult(row.id!!,row.version)
    }
    fun deactivateQuestion(actor: Actor,id: UUID,expectedVersion: Long): MutationResult {
        val question=questions.selectById(id) ?: missing();access.bank(actor,question.bankId!!,true);requireVersion(expectedVersion,question.version)
        sql.updateQuestion(id,question.chapterId,"INACTIVE",question.currentRevisionId!!);sql.bumpBank(question.bankId!!);return MutationResult(id,question.version+1)
    }
    fun preview(actor: Actor,bankId: UUID,input: ImportInput): ImportPreview {
        access.bank(actor,bankId);if(input.questions.size !in 1..1000) invalid("/questions")
        val issues=input.questions.mapIndexedNotNull { i,q -> try { if(q.questionBankId!=bankId) invalid("/questionBankId");validate(q);null } catch(e: ApiException) { PreviewIssue(i,e.code,e.message) } }
        return ImportPreview(issues.isEmpty(),input.questions.size,issues)
    }
    fun import(actor: Actor,bankId: UUID,input: ImportInput): ImportView {
        val bank=access.bank(actor,bankId,true);requireVersion(input.expectedContentVersion,bank.contentVersion)
        val preview=preview(actor,bankId,input);if(!preview.valid) invalid("/questions","IMPORT_VALIDATION_FAILED","导入校验失败，请先修正预览中的错误")
        val ids=input.questions.map { saveQuestion(actor,null,it).id }
        return ImportView(ids,banks.selectById(bankId).contentVersion)
    }
}
