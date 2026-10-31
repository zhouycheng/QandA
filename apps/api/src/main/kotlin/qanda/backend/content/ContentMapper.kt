package qanda.backend.content

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.util.UUID

class BankListFacts { var bankId: UUID?=null;var subjectName: String="";var questionCount: Long=0;var activeQuestionCount: Long=0;var answeredCount: Long=0;var correctCount: Long=0;var wrongCount: Long=0 }
class SubjectListFacts { var subjectId: UUID?=null;var bankCount: Long=0;var questionCount: Long=0;var answeredCount: Long=0;var correctCount: Long=0;var wrongCount: Long=0 }
class BankMaintainerRow { var bankId: UUID?=null;var adminId: UUID?=null }
class QuestionSummaryRow { var id: UUID?=null;var bankId: UUID?=null;var subjectId: UUID?=null;var chapterId: UUID?=null;var status: String="";var version: Long=0;var revisionId: UUID?=null;var revision: Int=0;var type: String="";var stem: String="";var subjectName: String="";var bankName: String="" }
@Mapper interface ContentQueries {
    fun favoriteQuestionIds(@Param("userId") userId: UUID,@Param("ids") ids: List<UUID>): List<UUID>
    fun subjectListFacts(@Param("ids") ids: List<UUID>,@Param("userId") userId: UUID): List<SubjectListFacts>
    fun bankListFacts(@Param("ids") ids: List<UUID>,@Param("userId") userId: UUID?): List<BankListFacts>
    fun bankAudiences(@Param("ids") ids: List<UUID>): List<BankAudience>
    fun bankMaintainers(@Param("ids") ids: List<UUID>): List<BankMaintainerRow>
    fun questionSummaries(@Param("ids") ids: List<UUID>): List<QuestionSummaryRow>
    fun bank(@Param("id") id: UUID): QuestionBank?
    fun lockBank(@Param("id") id: UUID): QuestionBank?
    fun banks(@Param("subjectId") subjectId: UUID?,@Param("keyword") keyword: String?,@Param("publicOnly") publicOnly: Boolean,@Param("adminId") adminId: UUID?,@Param("offset") offset: Int,@Param("limit") limit: Int): List<QuestionBank>
    fun bankCount(@Param("subjectId") subjectId: UUID?,@Param("keyword") keyword: String?,@Param("publicOnly") publicOnly: Boolean,@Param("adminId") adminId: UUID?): Long
    fun questionCount(@Param("bankId") bankId: UUID,@Param("activeOnly") activeOnly: Boolean): Long
    fun questions(@Param("bankId") bankId: UUID,@Param("chapterId") chapterId: UUID?,@Param("keyword") keyword: String?,@Param("activeOnly") activeOnly: Boolean,@Param("offset") offset: Int,@Param("limit") limit: Int): List<Question>
    fun filteredQuestionCount(@Param("bankId") bankId: UUID,@Param("chapterId") chapterId: UUID?,@Param("keyword") keyword: String?,@Param("activeOnly") activeOnly: Boolean): Long
    fun search(@Param("keyword") keyword: String,@Param("offset") offset: Int,@Param("limit") limit: Int): List<Question>
    fun searchCount(@Param("keyword") keyword: String): Long
    fun options(@Param("revisionId") revisionId: UUID): List<QuestionOption>
    fun insertOption(@Param("option") option: QuestionOption)
    fun attachments(@Param("revisionId") revisionId: UUID): List<UUID>
    fun attach(@Param("revisionId") revisionId: UUID,@Param("fileId") fileId: UUID)
    fun maintainers(@Param("bankId") bankId: UUID): List<UUID>
    fun clearMaintainers(@Param("bankId") bankId: UUID)
    fun addMaintainer(@Param("bankId") bankId: UUID,@Param("adminId") adminId: UUID)
    fun clearAudiences(@Param("bankId") bankId: UUID)
    fun bumpBank(@Param("id") id: UUID)
    fun updateQuestion(@Param("id") id: UUID,@Param("chapterId") chapterId: UUID?,@Param("status") status: String,@Param("revisionId") revisionId: UUID)
    fun chapterQuestions(@Param("id") id: UUID): Long
}
