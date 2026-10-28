package qanda.backend.practice

import qanda.backend.content.QuestionView
import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID

data class ScopeInput(val questionBankId: UUID,val chapterIds: List<UUID> = emptyList(),@field:Schema(minimum="1",maximum="1000") val count: Int=20,@field:Schema(allowableValues=["SEQUENTIAL","RANDOM"]) val order: String="SEQUENTIAL",@field:Schema(allowableValues=["NORMAL","WRONG","FAVORITE"]) val selectionKind: String="NORMAL")
data class ScopeView(val availableCount: Long,val contentVersion: Long)
data class CreatePracticeInput(val scope: ScopeInput,val expectedContentVersion: Long,@field:Schema(allowableValues=["AFTER_FINISH","IMMEDIATE"]) val feedback: String="AFTER_FINISH")
data class AnswerInput(val optionKeys: List<String>?=null,val value: Boolean?=null,val text: String?=null)
data class ItemProgress(val itemId: UUID,val answer: AnswerInput?=null,val confirmed: Boolean=false,val marked: Boolean=false)
data class ProgressInput(val expectedVersion: Long,val currentIndex: Int,val durationSeconds: Int,val items: List<ItemProgress> = emptyList())
data class FinishInput(val expectedVersion: Long,val durationSeconds: Int,val items: List<ItemProgress> = emptyList())
data class ExpectedVersionInput(val expectedVersion: Long)
data class SelfAssessmentInput(val expectedVersion: Long,@field:Schema(allowableValues=["CORRECT","WRONG"]) val assessment: String)
data class PracticeItemView(val itemId: UUID,val position: Int,val question: QuestionView,val answer: AnswerInput?,val confirmed: Boolean,val marked: Boolean,val outcome: String?,val selfAssessment: String?)
data class PracticeView(val id: UUID,val questionBankId: UUID,val status: String,val version: Long,val currentIndex: Int,val durationSeconds: Int,val feedback: String,val items: List<PracticeItemView>,val createdAt: Instant)
data class ObjectiveMetrics(val count: Int,val answered: Int,val correct: Int,val wrong: Int,val unanswered: Int,val accuracy: Double)
data class SelfMetrics(val count: Int,val answered: Int,val rated: Int,val correct: Int,val wrong: Int,val unrated: Int)
data class ResultView(val id: UUID,val sessionId: UUID,val version: Long,val totalCount: Int,val answeredCount: Int,val durationSeconds: Int,val objective: ObjectiveMetrics,val shortAnswer: SelfMetrics,val items: List<PracticeItemView>,val submittedAt: Instant)
data class PracticeSummary(val id: UUID,val questionBankId: UUID,val status: String,val version: Long,val durationSeconds: Int,val createdAt: Instant,val submittedAt: Instant?)
