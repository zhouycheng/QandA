package qanda.backend.operations

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("question_feedback")
class QuestionFeedback {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var questionId: UUID? = null
    var revisionId: UUID? = null
    var category: String = "OTHER"
    var body: String = ""
    var status: String = "OPEN"
    var response: String = ""
    var version: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}

@TableName("course_request")
class CourseRequest {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var courseName: String = ""
    var majorId: UUID? = null
    var body: String = ""
    var status: String = "OPEN"
    var response: String = ""
    var version: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}

@TableName("announcement")
class Announcement {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var title: String = ""
    var summary: String = ""
    var body: String = ""
    var audience: String = "ALL"
    var status: String = "DRAFT"
    var publishAt: Instant? = null
    var version: Long = 1
    var createdBy: UUID? = null
    var updatedAt: Instant = Instant.now()
}
