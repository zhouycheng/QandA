package qanda.backend.operations

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.util.UUID

class DashboardRow { var collegeCount: Long=0;var subjectCount: Long=0;var questionBankCount: Long=0;var questionCount: Long=0;var userCount: Long=0;var answeredCount: Long=0;var pendingFeedbackCount: Long=0 }
@Mapper interface OperationsMapper {
    fun issuedRevision(@Param("userId") userId: UUID,@Param("revisionId") revisionId: UUID): Boolean
    fun lockFeedback(@Param("id") id: UUID): QuestionFeedback?
    fun feedback(@Param("userId") userId: UUID?,@Param("adminId") adminId: UUID?,@Param("status") status: String?,@Param("offset") offset: Int,@Param("limit") limit: Int): List<QuestionFeedback>
    fun feedbackCount(@Param("userId") userId: UUID?,@Param("adminId") adminId: UUID?,@Param("status") status: String?): Long
    fun lockRequest(@Param("id") id: UUID): CourseRequest?
    fun requests(@Param("userId") userId: UUID?,@Param("status") status: String?,@Param("offset") offset: Int,@Param("limit") limit: Int): List<CourseRequest>
    fun requestCount(@Param("userId") userId: UUID?,@Param("status") status: String?): Long
    fun lockAnnouncement(@Param("id") id: UUID): Announcement?
    fun announcements(@Param("userId") userId: UUID?,@Param("platform") platform: String?,@Param("offset") offset: Int,@Param("limit") limit: Int): List<Announcement>
    fun announcementCount(@Param("userId") userId: UUID?,@Param("platform") platform: String?): Long
    fun platforms(@Param("id") id: UUID): List<String>
    fun recipients(@Param("id") id: UUID): List<UUID>
    fun clearPlatforms(@Param("id") id: UUID)
    fun clearRecipients(@Param("id") id: UUID)
    fun addPlatform(@Param("id") id: UUID,@Param("platform") platform: String)
    fun addRecipient(@Param("id") id: UUID,@Param("userId") userId: UUID)
    fun updateAnnouncement(@Param("row") row: Announcement)
    fun dashboard(): DashboardRow
}
