package qanda.backend.operations

import qanda.backend.content.QuestionView
import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID

data class FeedbackInput(val questionId: UUID,val revisionId: UUID,@field:Schema(allowableValues=["ANSWER","EXPLANATION","STEM_OPTIONS","OTHER"]) val category: String,val body: String)
data class CourseRequestInput(val courseName: String,val body: String,val majorId: UUID?=null)
data class HandleInput(val expectedVersion: Long,@field:Schema(allowableValues=["OPEN","IN_PROGRESS","RESOLVED","DISMISSED"]) val status: String,val response: String)
data class FeedbackView(val id: UUID,val userId: UUID,@field:Schema(allowableValues=["ANSWER","EXPLANATION","STEM_OPTIONS","OTHER"]) val category: String,val body: String,val status: String,val response: String,val version: Long,val question: QuestionView,val createdAt: Instant,val updatedAt: Instant)
data class CourseRequestView(val id: UUID,val userId: UUID,val courseName: String,val majorId: UUID?,val body: String,val status: String,val response: String,val version: Long,val createdAt: Instant,val updatedAt: Instant)
data class AnnouncementInput(val title: String,val summary: String="",val body: String="",@field:Schema(allowableValues=["ALL","SELECTED"]) val audience: String="ALL",val userIds: List<UUID> = emptyList(),
                             val platforms: List<String> = listOf("WEB","MINI_PROGRAM"),@field:Schema(allowableValues=["DRAFT","PUBLISHED","SCHEDULED"]) val status: String="DRAFT",val publishAt: Instant?=null,val expectedVersion: Long?=null)
data class AnnouncementView(val id: UUID,val title: String,val summary: String,val body: String,val audience: String,val platforms: List<String>,val userIds: List<UUID>,val status: String,val publishAt: Instant?,val version: Long,val updatedAt: Instant)
data class DashboardView(val collegeCount: Long,val subjectCount: Long,val questionBankCount: Long,val questionCount: Long,val userCount: Long,val answeredCount: Long,val pendingFeedbackCount: Long)
