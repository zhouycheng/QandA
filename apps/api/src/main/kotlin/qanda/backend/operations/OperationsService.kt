package qanda.backend.operations

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.catalog.MajorMapper
import qanda.backend.content.*
import qanda.backend.identity.UserAccountMapper
import qanda.backend.platform.http.*
import qanda.backend.platform.security.Actor
import java.time.Clock
import java.util.UUID

@Service
@Transactional
class OperationsService(private val feedbacks: QuestionFeedbackMapper,private val requests: CourseRequestMapper,private val announcements: AnnouncementMapper,
                        private val sql: OperationsMapper,private val content: ContentService,private val access: ContentAccess,
                        private val questions: QuestionMapper,private val revisions: QuestionRevisionMapper,private val users: UserAccountMapper,private val majors: MajorMapper,private val clock: Clock) {
    private fun body(value: String): String=text(value,4000).also { if(it.isBlank()) invalid("/body") }
    fun feedback(actor: Actor,input: FeedbackInput): MutationResult {
        if(input.category !in setOf("ANSWER","EXPLANATION","STEM_OPTIONS","OTHER")) invalid("/category")
        val q=questions.selectById(input.questionId) ?: missing();val revision=revisions.selectById(input.revisionId) ?: missing();if(revision.questionId!=q.id) invalid("/revisionId")
        if(!sql.issuedRevision(actor.id,input.revisionId)) { content.question(actor,input.questionId);if(input.revisionId!=q.currentRevisionId) missing() }
        val row=QuestionFeedback().apply { id=UUID.randomUUID();userId=actor.id;questionId=q.id;revisionId=revision.id;category=input.category;body=body(input.body) }
        feedbacks.insert(row);return MutationResult(row.id!!,1)
    }
    fun request(actor: Actor,input: CourseRequestInput): MutationResult {
        input.majorId?.let { if(majors.selectById(it)==null) invalid("/majorId") }
        val row=CourseRequest().apply { id=UUID.randomUUID();userId=actor.id;courseName=name(input.courseName);majorId=input.majorId;body=body(input.body) }
        requests.insert(row);return MutationResult(row.id!!,1)
    }
    private fun feedbackView(row: QuestionFeedback,admin: Boolean): FeedbackView=FeedbackView(row.id!!,row.userId!!,row.category,row.body,row.status,row.response,row.version,
        content.questionView(questions.selectById(row.questionId),row.revisionId!!,admin),row.createdAt,row.updatedAt)
    private fun requestView(row: CourseRequest)=CourseRequestView(row.id!!,row.userId!!,row.courseName,row.majorId,row.body,row.status,row.response,row.version,row.createdAt,row.updatedAt)
    fun feedback(actor: Actor,status: String?,p: PageSpec): Page<FeedbackView> {
        val userId=actor.takeIf { it.kind=="USER" }?.id;val adminId=actor.takeIf { it.kind=="ADMIN" && it.role!="PLATFORM_ADMIN" }?.id
        return Page(sql.feedback(userId,adminId,status,p.offset,p.pageSize).map { feedbackView(it,actor.kind=="ADMIN") },sql.feedbackCount(userId,adminId,status),p.page,p.pageSize)
    }
    fun requests(actor: Actor,status: String?,p: PageSpec): Page<CourseRequestView> {
        val userId=actor.takeIf { it.kind=="USER" }?.id
        return Page(sql.requests(userId,status,p.offset,p.pageSize).map(::requestView),sql.requestCount(userId,status),p.page,p.pageSize)
    }
    private fun validateHandling(input: HandleInput) {
        if(input.status !in setOf("OPEN","IN_PROGRESS","RESOLVED","DISMISSED")) invalid("/status")
        text(input.response,4000)
        if(input.status in setOf("RESOLVED","DISMISSED") && input.response.isBlank()) invalid("/response","RESPONSE_REQUIRED","处理完成时请填写回复")
    }
    fun handleFeedback(actor: Actor,id: UUID,input: HandleInput): MutationResult {
        val row=sql.lockFeedback(id) ?: missing();access.bank(actor,questions.selectById(row.questionId).bankId!!,true);requireVersion(input.expectedVersion,row.version);validateHandling(input)
        row.status=input.status;row.response=input.response;row.version++;row.updatedAt=clock.instant();feedbacks.updateById(row);return MutationResult(id,row.version)
    }
    fun handleRequest(id: UUID,input: HandleInput): MutationResult {
        val row=sql.lockRequest(id) ?: missing();requireVersion(input.expectedVersion,row.version);validateHandling(input)
        row.status=input.status;row.response=input.response;row.version++;row.updatedAt=clock.instant();requests.updateById(row);return MutationResult(id,row.version)
    }
    fun announcement(row: Announcement,admin: Boolean): AnnouncementView = AnnouncementView(row.id!!,row.title,row.summary,row.body,row.audience,sql.platforms(row.id!!),if(admin) sql.recipients(row.id!!) else emptyList(),
        if(row.status=="SCHEDULED" && row.publishAt?.isAfter(clock.instant())==false) "PUBLISHED" else row.status,row.publishAt,row.version,row.updatedAt)
    fun announcements(actor: Actor,p: PageSpec): Page<AnnouncementView> {
        val userId=actor.takeIf { it.kind=="USER" }?.id
        return Page(sql.announcements(userId,actor.clientType,p.offset,p.pageSize).map { announcement(it,actor.kind=="ADMIN") },sql.announcementCount(userId,actor.clientType),p.page,p.pageSize)
    }
    fun saveAnnouncement(actor: Actor,id: UUID?,input: AnnouncementInput): MutationResult {
        if(input.audience !in setOf("ALL","SELECTED") || input.status !in setOf("DRAFT","PUBLISHED","SCHEDULED")) invalid("/status")
        if(input.platforms.any { it !in setOf("WEB","MINI_PROGRAM") } || input.platforms.distinct().size!=input.platforms.size || input.userIds.distinct().size!=input.userIds.size || input.userIds.size>1000) invalid("/audience")
        if(input.audience=="ALL" && input.userIds.isNotEmpty() || input.audience=="SELECTED" && input.userIds.isEmpty()) invalid("/userIds")
        if(input.status!="DRAFT" && (input.platforms.isEmpty() || input.summary.isBlank() || input.body.isBlank())) invalid("/body")
        if(input.status=="SCHEDULED" && input.publishAt==null) invalid("/publishAt")
        input.userIds.forEach { if(users.selectById(it)==null) invalid("/userIds") }
        val row=id?.let { sql.lockAnnouncement(it) ?: missing() } ?: Announcement().apply { this.id=UUID.randomUUID();createdBy=actor.id }
        if(id!=null) requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version)
        row.title=name(input.title);row.summary=text(input.summary,500);row.body=text(input.body,40000);row.audience=input.audience;row.status=input.status;row.publishAt=input.publishAt;row.updatedAt=clock.instant()
        if(id==null) announcements.insert(row) else { row.version++;sql.updateAnnouncement(row) }
        sql.clearPlatforms(row.id!!);sql.clearRecipients(row.id!!);input.platforms.forEach { sql.addPlatform(row.id!!,it) };input.userIds.forEach { sql.addRecipient(row.id!!,it) }
        return MutationResult(row.id!!,row.version)
    }
    fun deleteAnnouncement(id: UUID,expectedVersion: Long): MutationResult {
        val row=sql.lockAnnouncement(id) ?: missing();requireVersion(expectedVersion,row.version);sql.clearPlatforms(id);sql.clearRecipients(id);announcements.deleteById(id);return MutationResult(id,row.version)
    }
    fun dashboard(): DashboardView=sql.dashboard().let { DashboardView(it.collegeCount,it.subjectCount,it.questionBankCount,it.questionCount,it.userCount,it.answeredCount,it.pendingFeedbackCount) }
}
