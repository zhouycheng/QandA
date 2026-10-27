package qanda.backend.content.api

import com.fasterxml.jackson.databind.JsonNode
import qanda.backend.authorization.api.*
import java.time.Instant
import java.util.UUID

enum class ContentStatus { ACTIVE, INACTIVE }
enum class ContentView { LEARN, MANAGE }
enum class QuestionType { SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE, SHORT_ANSWER }
enum class QuestionOrder { SEQUENTIAL, RANDOM }
data class SubjectView(val id: UUID, val source: SubjectSource, val ownerAccountId: UUID?, val title: String, val description: String, val status: ContentStatus, val version: Long, val contentVersion: Long, val chapterCount: Long, val questionCount: Long, val updatedAt: Instant)
data class ChapterView(val id: UUID, val subjectId: UUID, val title: String, val status: ContentStatus, val position: Int, val version: Long, val questionCount: Long)
data class QuestionView(val id: UUID, val subjectId: UUID, val chapterId: UUID, val status: ContentStatus, val version: Long, val position: Int, val revisionId: UUID, val revisionNumber: Int, val payload: JsonNode)
data class QuestionSummary(val id: UUID, val subjectId: UUID, val chapterId: UUID, val revisionId: UUID, val type: QuestionType, val stemExcerpt: String, val version: Long, val status: ContentStatus, val position: Int)
data class ManagedRevision(val id: UUID, val questionId: UUID, val revisionNumber: Int, val payload: JsonNode, val createdBy: UUID, val createdAt: Instant)
data class MutationResult(val commandRequestId: UUID, val subjectId: UUID, val chapterId: UUID? = null, val questionId: UUID? = null, val revisionId: UUID? = null, val importId: UUID? = null, val fileId: UUID? = null, val version: Long, val contentVersion: Long, val completedAt: Instant)
data class ImageView(val fileId: UUID, val subjectId: UUID, val mediaType: String, val sizeBytes: Long, val widthPixels: Int, val heightPixels: Int, val readyAt: Instant)
data class ImportIssue(val documentOrdinal: Int, val itemIndex: Int?, val pointer: String, val code: String, val severity: String = "ERROR", val message: String)
data class ImportDocumentSummary(val ordinal: Int, val fileName: String, val chapterId: UUID, val questionCount: Int)
data class CommittedQuestion(val ordinal: Int, val questionId: UUID, val revisionId: UUID)
data class ImportView(val id: UUID, val subjectId: UUID, val state: String, val version: Long, val subjectContentVersion: Long, val createdAt: Instant, val expiresAt: Instant, val committedAt: Instant?, val cancelledAt: Instant?, val documents: List<ImportDocumentSummary>, val issues: List<ImportIssue>, val createdQuestions: List<CommittedQuestion>)

/** A capability tied to the current transaction and an actual row lock. */
interface SubjectGuard : AuthorizationSubjectGuard

data class SubjectLock(val id: UUID, val mode: GuardMode = GuardMode.SHARE)
data class CurrentQuestionMetadata(val questionId: UUID, val subjectId: UUID, val chapterId: UUID, val currentRevisionId: UUID, val questionType: QuestionType, val activeForNewSelection: Boolean)
data class ContentSelection(val subjectId: UUID, val chapterIds: List<UUID>, val questionIds: List<UUID>? = null, val count: Int, val order: QuestionOrder)
data class FixedChapter(val id: UUID, val title: String)
data class FixedQuestion(val questionId: UUID, val chapterId: UUID, val revisionId: UUID, val revisionNumber: Int, val payload: JsonNode)
data class AttachmentManifest(val fileId: UUID, val mediaType: String, val sizeBytes: Long, val sha256: String, val widthPixels: Int, val heightPixels: Int)
data class FixedContentSelection(val subjectId: UUID, val source: SubjectSource, val subjectTitle: String, val ownerAccountId: UUID?, val contentVersion: Long, val chapters: List<FixedChapter>, val items: List<FixedQuestion>, val attachments: List<AttachmentManifest>)
data class IssuedRevisionReference(val questionId: UUID, val revisionId: UUID)

/** SQL owned by Content. All values are positional binds; consumers may only compose reads. */
class CurrentQuestionScope internal constructor(val relationSql: String, val parameters: List<Any>, private val verify: () -> Unit) {
    fun assertCurrentTransaction() = verify()
}
interface ContentOperations {
    fun lockSubjectsInTransaction(requests: List<SubjectLock>): List<SubjectGuard>
    fun describeLocked(guard: SubjectGuard): SubjectAccessDescriptor
    fun resolveAccessibleQuestionRevisionsInTransaction(actor: AuthorizationActor, accounts: AuthorizationAccountGuards, organizations: OrganizationGuards, subjectGuard: SubjectGuard, accessVerdict: AccessVerdict, selection: ContentSelection): FixedContentSelection
    fun readIssuedRevisionsInTransaction(subjectGuard: SubjectGuard, accessVerdict: AccessVerdict, issuedReferences: List<IssuedRevisionReference>): List<FixedQuestion>
    fun currentQuestionScopeForQuery(subjectGuards: List<SubjectGuard>, accessVerdicts: List<AccessVerdict>, chapterIds: List<UUID>? = null): CurrentQuestionScope
}
