package qanda.backend.learning

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.platform.http.*
import java.time.*
import java.time.temporal.ChronoUnit
import java.util.UUID

data class StatisticsView(val startDate: LocalDate,val endDateExclusive: LocalDate,val practiceCount: Long,val totalCount: Long,val answeredCount: Long,
                          val correctCount: Long,val wrongCount: Long,val unansweredCount: Long,val objectiveAccuracy: Double,val shortAnswerCount: Long,
                          val selfRatedCount: Long,val selfRatedCorrectCount: Long,val selfRatedWrongCount: Long,val durationSeconds: Long)
data class DayView(val date: LocalDate,val practiceCount: Long,val answeredCount: Long,val correctCount: Long,val durationSeconds: Long)
data class WrongView(val questionId: UUID,val questionBankId: UUID,val stem: String,val type: String,val lastOutcome: String,val lastPracticedAt: Instant,val rightCount: Long,val wrongCount: Long,val available: Boolean,val subjectId: UUID?=null,val subjectName: String?=null,val questionBankName: String?=null)
data class QuestionProgressView(val questionId: UUID,val questionBankId: UUID,val outcome: String,val lastPracticedAt: Instant)
data class WrongAttemptView(val sessionId: UUID,val revisionId: UUID,val outcome: String,val selfAssessment: String?,val submittedAt: Instant)
data class ActivityDayView(val date: LocalDate,val activeUsers: Long,val newUsers: Long,val returningUsers: Long)
data class ActivityView(val dailyActive: Long,val weeklyActive: Long,val monthlyActive: Long,val activeUsers: Long,val retention: Double,val records: List<ActivityDayView>)
data class RankingView(val userId: UUID,val nickname: String,val answeredCount: Long,val correctCount: Long,val durationSeconds: Long)
data class OrganizationView(val collegeId: UUID?,val collegeName: String?,val majorId: UUID?,val majorName: String?,val users: Long,val practiceCount: Long,val answeredCount: Long,val correctCount: Long)

@Service
@Transactional(readOnly=true)
class LearningService(private val sql: LearningMapper,private val clock: Clock) {
    private val zone=ZoneId.of("Asia/Shanghai")
    private val minimumDate=LocalDate.of(1900,1,1)
    private val maximumDateExclusive=LocalDate.of(2201,1,1)
    fun filter(period: String,date: LocalDate?,userId: UUID?=null,collegeId: UUID?=null,majorId: UUID?=null,platform: String?=null): StatsFilter {
        if(period !in setOf("DAY","WEEK","MONTH","ALL")) invalid("/period")
        val selected=date ?: LocalDate.now(clock.withZone(zone))
        if(selected < minimumDate || selected >= maximumDateExclusive) invalid("/periodDate")
        val end=selected.plusDays(1)
        val start=when(period) { "DAY" -> end.minusDays(1);"WEEK" -> end.minusDays(7);"MONTH" -> end.minusDays(30);"ALL" -> LocalDate.of(1900,1,1);else -> invalid("/period") }
        if(platform!=null && platform !in setOf("WEB","MINI_PROGRAM")) invalid("/period")
        return StatsFilter(start.atStartOfDay(zone).toInstant(),end.atStartOfDay(zone).toInstant(),userId,collegeId,majorId,platform)
    }
    fun statistics(f: StatsFilter): StatisticsView {
        val r=sql.stats(f);val self=sql.selfStats(f);val answered=r.correctCount+r.wrongCount
        return StatisticsView(f.start.atZone(zone).toLocalDate(),f.end.atZone(zone).toLocalDate(),r.practiceCount,r.totalCount,r.answeredCount,r.correctCount,r.wrongCount,r.unansweredCount,
            if(answered==0L) 0.0 else r.correctCount.toDouble()/answered,r.shortAnswerCount,self.rated,self.correct,self.wrong,r.durationSeconds)
    }
    fun days(userId: UUID,start: LocalDate,end: LocalDate): List<DayView> {
        if(start < minimumDate || end > maximumDateExclusive || end <= start || ChronoUnit.DAYS.between(start,end) !in 1..366) invalid("/dateRange")
        val rows=sql.days(StatsFilter(start.atStartOfDay(zone).toInstant(),end.atStartOfDay(zone).toInstant(),userId)).associateBy { it.day }
        return start.datesUntil(end).map { day -> val r=rows[day];DayView(day,r?.practiceCount ?: 0,r?.answeredCount ?: 0,r?.correctCount ?: 0,r?.durationSeconds ?: 0) }.toList()
    }
    fun wrong(userId: UUID,status: String,bankId: UUID?,p: PageSpec): Page<WrongView> {
        if(status !in setOf("ALL","UNMASTERED","MASTERED")) invalid("/status")
        return Page(sql.wrong(userId,status,bankId,p.offset,p.pageSize).map { WrongView(it.questionId!!,it.bankId!!,it.stem,it.type,it.lastOutcome,it.lastPracticedAt,it.rightCount,it.wrongCount,it.available) },sql.wrongCount(userId,status,bankId),p.page,p.pageSize)
    }
    fun questionProgress(userId: UUID,bankId: UUID?,p: PageSpec): Page<QuestionProgressView> = Page(sql.questionProgress(userId,bankId,p.offset,p.pageSize).map { QuestionProgressView(it.questionId!!,it.bankId!!,it.lastOutcome,it.lastPracticedAt) },sql.questionProgressCount(userId,bankId),p.page,p.pageSize)
    fun wrongHistory(userId: UUID,questionId: UUID,p: PageSpec): Page<WrongAttemptView> = Page(sql.wrongHistory(userId,questionId,p.offset,p.pageSize).map { WrongAttemptView(it.sessionId!!,it.revisionId!!,it.outcome,it.selfAssessment,it.submittedAt) },sql.wrongHistoryCount(userId,questionId),p.page,p.pageSize)
    fun activity(f: StatsFilter): ActivityView {
        val length=Duration.between(f.start,f.end);val previous=f.copy(start=f.start.minus(length),end=f.start)
        val base=sql.activeCount(previous);val today=f.copy(start=f.end.minus(Duration.ofDays(1)))
        val week=f.copy(start=f.end.minus(Duration.ofDays(7)));val month=f.copy(start=f.end.minus(Duration.ofDays(30)))
        val records=sql.activityDays(f).map { ActivityDayView(it.day,it.activeUsers,it.newUsers,it.activeUsers-it.newUsers) }
        return ActivityView(sql.activeCount(today),sql.activeCount(week),sql.activeCount(month),sql.activeCount(f),if(base==0L) 0.0 else sql.returningCount(f,previous.start).toDouble()/base,records)
    }
    fun rankings(f: StatsFilter,p: PageSpec): Page<RankingView> = Page(sql.ranking(f,p.offset,p.pageSize).map { RankingView(it.userId!!,it.nickname,it.answeredCount,it.correctCount,it.durationSeconds) },sql.rankingCount(f),p.page,p.pageSize)
    fun organizations(f: StatsFilter,p: PageSpec): Page<OrganizationView> = Page(sql.organizations(f,p.offset,p.pageSize).map { OrganizationView(it.collegeId,it.collegeName,it.majorId,it.majorName,it.users,it.practiceCount,it.answeredCount,it.correctCount) },sql.organizationCount(f),p.page,p.pageSize)
}
