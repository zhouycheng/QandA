package qanda.backend.discovery

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import qanda.backend.catalog.Subject
import qanda.backend.content.QuestionBank
import java.time.Instant
import java.util.UUID

class UserSubject { var userId: UUID?=null;var subjectId: UUID?=null;var preferredBankId: UUID?=null;var sortOrder: Int=0;var version: Long=1;var addedAt: Instant=Instant.now() }
class FavoriteRow { var questionId: UUID?=null;var bankId: UUID?=null;var stem: String="";var type: String="";var available: Boolean=false;var createdAt: Instant=Instant.now() }
@Mapper interface DiscoveryMapper {
    fun choice(@Param("userId") userId: UUID,@Param("subjectId") subjectId: UUID): UserSubject?
    fun choices(@Param("userId") userId: UUID,@Param("offset") offset: Int,@Param("limit") limit: Int): List<UserSubject>
    fun choiceCount(@Param("userId") userId: UUID): Long
    fun saveChoice(@Param("row") row: UserSubject)
    fun removeChoice(@Param("userId") userId: UUID,@Param("subjectId") subjectId: UUID)
    fun favorite(@Param("userId") userId: UUID,@Param("questionId") questionId: UUID)
    fun unfavorite(@Param("userId") userId: UUID,@Param("questionId") questionId: UUID)
    fun favorites(@Param("userId") userId: UUID,@Param("offset") offset: Int,@Param("limit") limit: Int): List<FavoriteRow>
    fun favoriteCount(@Param("userId") userId: UUID): Long
    fun recommendedSubjects(@Param("userId") userId: UUID,@Param("offset") offset: Int,@Param("limit") limit: Int): List<Subject>
    fun recommendedCount(@Param("userId") userId: UUID): Long
    fun recommendedBanks(@Param("userId") userId: UUID,@Param("subjectId") subjectId: UUID): List<QuestionBank>
}
