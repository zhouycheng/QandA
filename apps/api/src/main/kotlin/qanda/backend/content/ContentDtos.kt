package qanda.backend.content

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID
import jakarta.validation.constraints.Size

data class AudienceInput(val collegeId: UUID?=null,val majorId: UUID?=null,val enrollmentYear: Int?=null)
data class BankInput(val subjectId: UUID,val name: String,val description: String="",val textbook: String="",@field:Schema(allowableValues=["ACTIVE","INACTIVE"]) val status: String="ACTIVE",
                     @field:Schema(allowableValues=["ALL","TARGETED"]) val scopeType: String="ALL",val audiences: List<AudienceInput> = emptyList(),@field:Schema(description="省略时保留维护者；仅平台管理员可以变更名单") val maintainerIds: List<UUID>?=null,val expectedVersion: Long?=null)
data class BankView(val id: UUID,val subjectId: UUID,val name: String,val description: String,val textbook: String,val status: String,val publicationStatus: String,
                    @field:Schema(allowableValues=["ALL","TARGETED"]) val scopeType: String,val audiences: List<AudienceInput>,val maintainerIds: List<UUID>,val version: Long,val contentVersion: Long,val questionCount: Long,val activeQuestionCount: Long,val updatedAt: Instant,val subjectName: String?=null,val progress: BankProgressView?=null)
data class BankProgressView(val answeredCount: Long,val correctCount: Long,val wrongCount: Long)
data class ChapterInput(val name: String,val sortOrder: Int,val expectedVersion: Long?=null)
data class ChapterView(val id: UUID,val questionBankId: UUID,val name: String,val sortOrder: Int,val version: Long)
data class ReorderInput(val expectedContentVersion: Long,val ids: List<UUID>)
data class PublicationInput(val expectedVersion: Long,@field:Schema(allowableValues=["DRAFT","PUBLISHED","UNPUBLISHED","ARCHIVED"]) val status: String)
data class OptionInput(val key: String,val content: String)
data class QuestionInput(val questionBankId: UUID,@field:Schema(allowableValues=["SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER"]) val type: String,val stem: String,val chapterId: UUID?=null,val options: List<OptionInput> = emptyList(),
                         val correctAnswer: List<String> = emptyList(),val correctValue: Boolean?=null,val referenceAnswer: String?=null,val explanation: String="",
                         val assetIds: List<UUID> = emptyList(),@field:Schema(allowableValues=["ACTIVE","INACTIVE"]) val status: String="ACTIVE",val expectedVersion: Long?=null)
data class QuestionView(val id: UUID,val questionBankId: UUID,val chapterId: UUID?,val status: String,val version: Long,val revisionId: UUID,val revision: Int,
                        @field:Schema(allowableValues=["SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER"]) val type: String,val stem: String,val options: List<OptionInput>,val correctAnswer: List<String>?,val correctValue: Boolean?,val referenceAnswer: String?,
                        val explanation: String?,val assetIds: List<UUID>,val subjectId: UUID?=null,val subjectName: String?=null,val questionBankName: String?=null)
data class ImportInput(val expectedContentVersion: Long,@field:Size(min=1,max=1000) val questions: List<QuestionInput>)
data class ImportView(val questionIds: List<UUID>,val contentVersion: Long)
data class PreviewIssue(val index: Int,val code: String,val message: String)
data class ImportPreview(val valid: Boolean,val questionCount: Int,val issues: List<PreviewIssue>)
