package qanda.backend.catalog

import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.*
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import qanda.backend.platform.security.*
import java.util.UUID

@RestController
@RequestMapping("/api/v1",produces=["application/json"])
class CatalogController(private val service: CatalogService,private val sessions: Sessions,private val commands: Commands) {
    @GetMapping("/colleges") fun colleges(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<CollegeView> = service.colleges(PageSpec(page,pageSize),false)
    @GetMapping("/colleges/{id}/majors") fun majors(@PathVariable id: UUID,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<MajorView> = service.majors(id,PageSpec(page,pageSize),false)
    @GetMapping("/subjects") fun subjects(@RequestParam(required=false) keyword: String?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<SubjectView> { sessions.student();return service.subjects(PageSpec(page,pageSize),keyword,true) }
    @GetMapping("/subjects/{id}") fun subject(@PathVariable id: UUID): SubjectView { sessions.student();return service.subject(id,true) }
    @GetMapping("/admin/colleges") fun adminColleges(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<CollegeView> { sessions.admin();return service.colleges(PageSpec(page,pageSize),true) }
    @GetMapping("/admin/colleges/{id}/majors") fun adminMajors(@PathVariable id: UUID,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<MajorView> { sessions.admin();return service.majors(id,PageSpec(page,pageSize),true) }
    @GetMapping("/admin/subjects") fun adminSubjects(@RequestParam(required=false) keyword: String?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<SubjectView> { sessions.admin();return service.subjects(PageSpec(page,pageSize),keyword,false) }
    @PostMapping("/admin/colleges") fun createCollege(@RequestBody input: CollegeInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"CREATE_COLLEGE",input,MutationResult::class.java,r.requestId()) { service.college(null,input) } }
    @PutMapping("/admin/colleges/{id}") fun updateCollege(@PathVariable id: UUID,@RequestBody input: CollegeInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"UPDATE_COLLEGE:$id",input,MutationResult::class.java,r.requestId()) { service.college(id,input) } }
    @PostMapping("/admin/majors") fun createMajor(@RequestBody input: MajorInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"CREATE_MAJOR",input,MutationResult::class.java,r.requestId()) { service.major(null,input) } }
    @PutMapping("/admin/majors/{id}") fun updateMajor(@PathVariable id: UUID,@RequestBody input: MajorInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"UPDATE_MAJOR:$id",input,MutationResult::class.java,r.requestId()) { service.major(id,input) } }
    @PostMapping("/admin/subjects") fun createSubject(@RequestBody input: SubjectInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"CREATE_SUBJECT",input,MutationResult::class.java,r.requestId()) { service.subject(null,input) } }
    @PutMapping("/admin/subjects/{id}") fun updateSubject(@PathVariable id: UUID,@RequestBody input: SubjectInput,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): MutationResult { val a=sessions.admin(true);return commands.run(a,key,"UPDATE_SUBJECT:$id",input,MutationResult::class.java,r.requestId()) { service.subject(id,input) } }
}
