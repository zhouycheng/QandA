package qanda.backend.content

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.util.UUID

@Mapper interface ContentQueries {
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
