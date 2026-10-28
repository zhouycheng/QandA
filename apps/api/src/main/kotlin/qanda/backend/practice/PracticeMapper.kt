package qanda.backend.practice

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import qanda.backend.content.Question
import java.util.UUID

@Mapper interface PracticeQueries {
    fun eligible(@Param("userId") userId: UUID,@Param("scope") scope: ScopeInput): List<Question>
    fun eligibleCount(@Param("userId") userId: UUID,@Param("scope") scope: ScopeInput): Long
    fun lockSession(@Param("id") id: UUID): PracticeSession?
    fun items(@Param("sessionId") sessionId: UUID): List<PracticeItem>
    fun choices(@Param("itemId") itemId: UUID): List<String>
    fun clearChoices(@Param("itemId") itemId: UUID)
    fun addChoice(@Param("itemId") itemId: UUID,@Param("revisionId") revisionId: UUID,@Param("key") key: String)
    fun updateAnswer(@Param("item") item: PracticeItem)
    fun result(@Param("sessionId") sessionId: UUID): PracticeResult?
    fun history(@Param("userId") userId: UUID,@Param("completedOnly") completedOnly: Boolean,@Param("offset") offset: Int,@Param("limit") limit: Int): List<PracticeSession>
    fun historyCount(@Param("userId") userId: UUID,@Param("completedOnly") completedOnly: Boolean): Long
}
