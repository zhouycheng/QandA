package qanda.backend.learning

import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.*
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import qanda.backend.practice.*
import java.time.LocalDate
import java.util.UUID

@RestController
@RequestMapping("/api/v1",produces=["application/json"])
class LearningController(private val reads: LearningReadService,private val service: LearningService,private val practice: PracticeService,private val sessions: Sessions) {
    @GetMapping("/me/learning-overview") fun overview(): LearningOverviewView = reads.overview(sessions.student().id)
    @GetMapping("/me/question-collections/summary") fun collectionSummary(@RequestParam kind: String): CollectionSummaryView = reads.summary(sessions.student().id,kind)
    @GetMapping("/me/practice-history") fun history(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<PracticeSummary> = practice.history(sessions.student().id,PageSpec(page,pageSize),true)
    @GetMapping("/me/practice-history/{id}") fun record(@PathVariable id: UUID): ResultView=practice.result(sessions.student().id,id)
    @GetMapping("/me/recent-learning") fun recent(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<PracticeSummary> = practice.history(sessions.student().id,PageSpec(page,pageSize),false)
    @GetMapping("/me/question-progress") fun questionProgress(@RequestParam(required=false) questionBankId: UUID?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<QuestionProgressView> = service.questionProgress(sessions.student().id,questionBankId,PageSpec(page,pageSize))
    @GetMapping("/me/wrong-questions") fun wrong(@RequestParam(defaultValue="UNMASTERED") status: String,@RequestParam(required=false) questionBankId: UUID?,@RequestParam(required=false) subjectId: UUID?,@RequestParam(defaultValue="all") chip: String,@RequestParam(defaultValue="recent") sort: String,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<WrongView> = reads.wrong(sessions.student().id,status,questionBankId,PageSpec(page,pageSize),subjectId,chip,sort)
    @GetMapping("/me/wrong-questions/{id}/history") fun wrongHistory(@PathVariable id: UUID,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<WrongAttemptView> = service.wrongHistory(sessions.student().id,id,PageSpec(page,pageSize))
    @GetMapping("/me/statistics") fun summary(@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?): StatisticsView = service.statistics(service.filter(period,periodDate,sessions.student().id))
    @GetMapping("/me/statistics/days") fun days(@RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) startDate: LocalDate,@RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) endDateExclusive: LocalDate): List<DayView> = service.days(sessions.student().id,startDate,endDateExclusive)
    @GetMapping("/admin/students/{id}/practice-history") fun studentHistory(@PathVariable id: UUID,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<PracticeSummary> { sessions.admin(true);return practice.history(id,PageSpec(page,pageSize),true) }
    @GetMapping("/admin/students/{id}/practice-history/{sessionId}") fun studentResult(@PathVariable id: UUID,@PathVariable sessionId: UUID): ResultView { sessions.admin(true);return practice.result(id,sessionId) }
    @GetMapping("/admin/students/{id}/statistics") fun studentSummary(@PathVariable id: UUID,@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?): StatisticsView { sessions.admin(true);return service.statistics(service.filter(period,periodDate,id)) }
    @GetMapping("/admin/statistics/summary") fun adminSummary(@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?,@RequestParam(required=false) collegeId: UUID?,@RequestParam(required=false) majorId: UUID?,@RequestParam(required=false) platform: String?): StatisticsView { sessions.admin(true);return service.statistics(service.filter(period,periodDate,collegeId=collegeId,majorId=majorId,platform=platform)) }
    @GetMapping("/admin/statistics/activity") fun activity(@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?,@RequestParam(required=false) platform: String?): ActivityView { sessions.admin(true);return service.activity(service.filter(period,periodDate,platform=platform)) }
    @GetMapping("/admin/statistics/rankings") fun rankings(@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?,@RequestParam(required=false) collegeId: UUID?,@RequestParam(required=false) majorId: UUID?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<RankingView> { sessions.admin(true);return service.rankings(service.filter(period,periodDate,collegeId=collegeId,majorId=majorId),PageSpec(page,pageSize)) }
    @GetMapping("/admin/statistics/organizations") fun organizations(@RequestParam(defaultValue="WEEK") period: String,@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) periodDate: LocalDate?,@RequestParam(required=false) collegeId: UUID?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<OrganizationView> { sessions.admin(true);return service.organizations(service.filter(period,periodDate,collegeId=collegeId),PageSpec(page,pageSize)) }
}
