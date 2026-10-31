package qanda.backend.discovery

import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.*
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import qanda.backend.platform.security.*
import java.util.UUID

@RestController
@RequestMapping("/api/v1/me",produces=["application/json"])
class DiscoveryController(private val reads: qanda.backend.learning.LearningReadService,private val service: DiscoveryService,private val sessions: Sessions,private val commands: Commands) {
    @GetMapping("/recommendations") fun recommendations(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<Recommendation> = service.recommendations(sessions.student(),PageSpec(page,pageSize))
    @GetMapping("/subjects") fun courses(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<CourseView> = service.courses(sessions.student(),PageSpec(page,pageSize))
    @PutMapping("/subjects/{id}") fun saveCourse(@PathVariable id: UUID,@RequestBody input: CourseInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.student();return commands.run(a,key,"SAVE_COURSE:$id",input,MutationResult::class.java,r.requestId()) { service.save(a,id,input) } }
    @DeleteMapping("/subjects/{id}") fun removeCourse(@PathVariable id: UUID,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.student();return commands.run(a,key,"REMOVE_COURSE:$id",id,MutationResult::class.java,r.requestId()) { service.remove(a,id) } }
    @GetMapping("/favorites") fun favorites(@RequestParam(required=false) subjectId: UUID?,@RequestParam(required=false) questionBankId: UUID?,@RequestParam(defaultValue="all") chip: String,@RequestParam(defaultValue="recent") sort: String,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<FavoriteView> = reads.favorites(sessions.student().id,PageSpec(page,pageSize),subjectId,questionBankId,chip,sort)
    @PutMapping("/favorites/{id}") fun favorite(@PathVariable id: UUID,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.student();return commands.run(a,key,"FAVORITE:$id",id,MutationResult::class.java,r.requestId()) { service.favorite(a,id,true) } }
    @DeleteMapping("/favorites/{id}") fun unfavorite(@PathVariable id: UUID,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.student();return commands.run(a,key,"UNFAVORITE:$id",id,MutationResult::class.java,r.requestId()) { service.favorite(a,id,false) } }
}
