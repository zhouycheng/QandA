package qanda.backend.learning

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.discovery.FavoriteView
import qanda.backend.platform.http.*
import qanda.backend.practice.PracticeSession
import qanda.backend.practice.PracticeSummary
import java.time.Clock
import java.time.Instant
import java.util.UUID

class OverviewRow {
    var answeredCount: Long=0;var correctCount: Long=0;var wrongCount: Long=0;var masteredCount: Long=0
    var favoriteCount: Long=0;var totalCount: Long=0;var subjectCount: Long=0;var bankCount: Long=0
    var durationSeconds: Long=0;var practiceCount: Long=0
}
data class LearningOverviewView(val answeredCount: Long,val correctCount: Long,val wrongCount: Long,val masteredCount: Long,
    val favoriteCount: Long,val totalCount: Long,val subjectCount: Long,val bankCount: Long,val durationSeconds: Long,
    val practiceCount: Long,val recentSession: PracticeSummary?)
class CollectionRow {
    var questionId: UUID?=null;var questionBankId: UUID?=null;var subjectId: UUID?=null
    var questionBankName: String="";var subjectName: String="";var stem: String="";var type: String=""
    var available: Boolean=false;var practiced: Boolean=false;var createdAt: Instant=Instant.EPOCH
    var lastPracticedAt: Instant?=null;var lastOutcome: String="";var rightCount: Long=0;var wrongCount: Long=0
}
class CollectionTotals {
    var total: Long=0;var repeatCount: Long=0;var recentCount: Long=0;var practicedCount: Long=0
    var rightCount: Long=0;var wrongCount: Long=0
}
class CollectionFacet {
    var subjectId: UUID?=null;var subjectName: String="";var questionBankId: UUID?=null;var questionBankName: String="";var count: Long=0
}
data class CollectionSummaryView(val total: Long,val repeatCount: Long,val recentCount: Long,val practicedCount: Long,
    val pendingCount: Long,val rightCount: Long,val wrongCount: Long,val facets: List<CollectionFacet>)
data class CollectionFilter(val kind: String,val status: String="UNMASTERED",val subjectId: UUID?=null,val bankId: UUID?=null,
    val chip: String="all",val sort: String="recent",val since: Instant)
@Mapper interface LearningReadMapper {
    fun overview(@Param("userId") userId: UUID): OverviewRow
    fun latestSession(@Param("userId") userId: UUID): PracticeSession?
    fun collection(@Param("userId") userId: UUID,@Param("f") f: CollectionFilter,@Param("offset") offset: Int,@Param("limit") limit: Int): List<CollectionRow>
    fun collectionCount(@Param("userId") userId: UUID,@Param("f") f: CollectionFilter): Long
    fun collectionTotals(@Param("userId") userId: UUID,@Param("f") f: CollectionFilter): CollectionTotals
    fun collectionFacets(@Param("userId") userId: UUID,@Param("f") f: CollectionFilter): List<CollectionFacet>
}
@Service
@Transactional(readOnly=true)
class LearningReadService(private val sql: LearningReadMapper,private val clock: Clock) {
    fun overview(userId: UUID): LearningOverviewView {
        val r=sql.overview(userId);val s=sql.latestSession(userId)
        return LearningOverviewView(r.answeredCount,r.correctCount,r.wrongCount,r.masteredCount,r.favoriteCount,r.totalCount,
            r.subjectCount,r.bankCount,r.durationSeconds,r.practiceCount,s?.let { PracticeSummary(it.id!!,it.bankId!!,it.status,it.version,it.durationSeconds,it.createdAt,it.submittedAt) })
    }
    private fun filter(kind: String,status: String="UNMASTERED",subjectId: UUID?=null,bankId: UUID?=null,chip: String="all",sort: String="recent"): CollectionFilter {
        if(kind !in setOf("WRONG","FAVORITE")) invalid("/kind")
        if(status !in setOf("ALL","UNMASTERED","MASTERED")) invalid("/status")
        if(chip !in if(kind=="WRONG") setOf("all","repeat","recent") else setOf("all","pending","practiced")) invalid("/chip")
        if(sort !in if(kind=="WRONG") setOf("urgent","recent") else setOf("recent","old")) invalid("/sort")
        return CollectionFilter(kind,status,subjectId,bankId,chip,sort,clock.instant().minusSeconds(7*86400))
    }
    fun summary(userId: UUID,kind: String): CollectionSummaryView {
        val f=filter(kind);val r=sql.collectionTotals(userId,f)
        return CollectionSummaryView(r.total,r.repeatCount,r.recentCount,r.practicedCount,r.total-r.practicedCount,r.rightCount,r.wrongCount,sql.collectionFacets(userId,f))
    }
    fun wrong(userId: UUID,status: String,bankId: UUID?,p: PageSpec,subjectId: UUID?=null,chip: String="all",sort: String="recent"): Page<WrongView> {
        val f=filter("WRONG",status,subjectId,bankId,chip,sort)
        return Page(sql.collection(userId,f,p.offset,p.pageSize).map { WrongView(it.questionId!!,it.questionBankId!!,it.stem,it.type,it.lastOutcome,it.lastPracticedAt!!,it.rightCount,it.wrongCount,it.available,it.subjectId,it.subjectName,it.questionBankName) },sql.collectionCount(userId,f),p.page,p.pageSize)
    }
    fun favorites(userId: UUID,p: PageSpec,subjectId: UUID?=null,bankId: UUID?=null,chip: String="all",sort: String="recent"): Page<FavoriteView> {
        val f=filter("FAVORITE",subjectId=subjectId,bankId=bankId,chip=chip,sort=sort)
        return Page(sql.collection(userId,f,p.offset,p.pageSize).map { FavoriteView(it.questionId!!,it.questionBankId!!,it.stem,it.type,it.available,it.createdAt,it.subjectId,it.subjectName,it.questionBankName,it.practiced) },sql.collectionCount(userId,f),p.page,p.pageSize)
    }
}
