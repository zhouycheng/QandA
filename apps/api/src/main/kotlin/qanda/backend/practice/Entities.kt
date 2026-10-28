package qanda.backend.practice

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("practice_session")
class PracticeSession {
    var clientType: String = "WEB"
    var updatedAt: Instant = Instant.now()
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var bankId: UUID? = null
    var selectionKind: String = "NORMAL"
    var questionOrder: String = "SEQUENTIAL"
    var feedback: String = "AFTER_FINISH"
    var status: String = "IN_PROGRESS"
    var version: Long = 1
    var currentIndex: Int = 0
    var durationSeconds: Int = 0
    var createdAt: Instant = Instant.now()
    var submittedAt: Instant? = null
}

@TableName("practice_item")
class PracticeItem {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var sessionId: UUID? = null
    var questionId: UUID? = null
    var revisionId: UUID? = null
    var position: Int = 0
    var answerText: String? = null
    var answerBoolean: Boolean? = null
    var confirmed: Boolean = false
    var marked: Boolean = false
    var outcome: String? = null
    var selfAssessment: String? = null
}

@TableName("practice_result")
class PracticeResult {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var sessionId: UUID? = null
    var totalCount: Int = 0
    var objectiveCount: Int = 0
    var answeredCount: Int = 0
    var correctCount: Int = 0
    var wrongCount: Int = 0
    var unansweredCount: Int = 0
    var shortAnswerCount: Int = 0
    var durationSeconds: Int = 0
    var createdAt: Instant = Instant.now()
}
