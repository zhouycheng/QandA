package qanda.backend.discovery

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.catalog.*
import qanda.backend.content.*
import qanda.backend.identity.IdentityService
import qanda.backend.platform.http.*
import qanda.backend.platform.security.Actor
import java.time.Instant
import java.util.UUID

data class CourseInput(val preferredBankId: UUID?=null,val sortOrder: Int=0,val expectedVersion: Long?=null)
data class CourseView(val subject: SubjectView,val preferredBankId: UUID?,val preferredBankAvailable: Boolean,val sortOrder: Int,val version: Long,val addedAt: Instant)
data class RecommendedBank(val bank: BankView,val reasons: List<String>)
data class Recommendation(val subject: SubjectView,val banks: List<RecommendedBank>)
data class FavoriteView(val questionId: UUID,val questionBankId: UUID,val stem: String,val type: String,val available: Boolean,val createdAt: Instant)

@Service
@Transactional
class DiscoveryService(private val sql: DiscoveryMapper,private val catalog: CatalogService,private val identity: IdentityService,private val content: ContentService,
                       private val contentSql: ContentQueries,private val audiences: BankAudienceMapper,private val questions: QuestionMapper) {
    fun courses(actor: Actor,p: PageSpec): Page<CourseView> = Page(sql.choices(actor.id,p.offset,p.pageSize).map {
        CourseView(catalog.subject(it.subjectId!!,false),it.preferredBankId,it.preferredBankId?.let { id -> contentSql.bank(id)!=null } ?: false,it.sortOrder,it.version,it.addedAt)
    },sql.choiceCount(actor.id),p.page,p.pageSize)
    fun save(actor: Actor,subjectId: UUID,input: CourseInput): MutationResult {
        catalog.subject(subjectId,true)
        val existing=sql.choice(actor.id,subjectId)
        if(existing!=null && input.expectedVersion==null) return MutationResult(subjectId,existing.version)
        existing?.let { requireVersion(input.expectedVersion!!,it.version) }
        if(input.sortOrder !in 0..10000) invalid("/sortOrder")
        input.preferredBankId?.let { if(contentSql.bank(it)?.subjectId!=subjectId) invalid("/preferredBankId","BANK_SUBJECT_MISMATCH","常用题库必须是该课程已发布的题库") }
        val row=existing ?: UserSubject().apply { userId=actor.id;this.subjectId=subjectId }
        row.preferredBankId=input.preferredBankId;row.sortOrder=input.sortOrder;if(existing!=null) row.version++
        sql.saveChoice(row);return MutationResult(subjectId,row.version)
    }
    fun remove(actor: Actor,subjectId: UUID): MutationResult { sql.removeChoice(actor.id,subjectId);return MutationResult(subjectId,1) }
    fun favorite(actor: Actor,id: UUID,enabled: Boolean): MutationResult {
        if(enabled) content.question(actor,id)
        if(enabled) sql.favorite(actor.id,id) else sql.unfavorite(actor.id,id)
        return MutationResult(id,1)
    }
    fun favorites(actor: Actor,p: PageSpec): Page<FavoriteView> = Page(sql.favorites(actor.id,p.offset,p.pageSize).map { FavoriteView(it.questionId!!,it.bankId!!,it.stem,it.type,it.available,it.createdAt) },sql.favoriteCount(actor.id),p.page,p.pageSize)
    fun recommendations(actor: Actor,p: PageSpec): Page<Recommendation> {
        val user=identity.view(actor.id)
        val items=sql.recommendedSubjects(actor.id,p.offset,p.pageSize).map { subject ->
            Recommendation(catalog.subjectView(subject),sql.recommendedBanks(actor.id,subject.id!!).map { bank ->
                val reasons=if(bank.scopeType=="ALL") listOf("全校通用") else audiences.selectList(QueryWrapper<BankAudience>().eq("bank_id",bank.id)).filter {
                    (it.majorId==null || it.majorId==user.majorId) && (it.collegeId==null || it.collegeId==user.collegeId) && (it.enrollmentYear==null || it.enrollmentYear==user.enrollmentYear)
                }.flatMap { listOfNotNull(if(it.majorId!=null) "符合所选专业" else if(it.collegeId!=null) "符合所选学院" else null,it.enrollmentYear?.let { year -> "适用于${year}级" }) }.distinct()
                RecommendedBank(content.bankView(bank,false),reasons)
            })
        }
        return Page(items,sql.recommendedCount(actor.id),p.page,p.pageSize)
    }
}
