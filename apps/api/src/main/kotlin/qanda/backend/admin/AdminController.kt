package qanda.backend.admin

import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.*
import qanda.backend.identity.*
import qanda.backend.platform.http.*
import qanda.backend.platform.security.*
import java.util.UUID

@RestController
@RequestMapping("/api/v1/admin",produces=["application/json"])
class AdminController(private val service: AdminService,private val sessions: Sessions,private val commands: Commands) {
    @PostMapping("/auth/sessions") fun login(@RequestBody input: AdminLoginInput): TokenView=service.login(input)
    @GetMapping("/auth/me") fun me(): AdminView=service.current(sessions.admin())
    @PostMapping("/auth/logout") fun logout(): MutationResult=service.logout(sessions.admin())
    @GetMapping("/administrators") fun list(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<AdminView> { sessions.admin(true);return service.list(PageSpec(page,pageSize)) }
    @PostMapping("/administrators")
    fun create(@RequestBody input: AdminInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.admin(true);return commands.run(actor,key,"CREATE_ADMIN",input,MutationResult::class.java,request.requestId()) { service.save(null,input) }
    }
    @PutMapping("/administrators/{id}")
    fun update(@PathVariable id: UUID,@RequestBody input: AdminInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.admin(true);return commands.run(actor,key,"UPDATE_ADMIN:$id",input,MutationResult::class.java,request.requestId()) { service.save(id,input) }
    }
    @DeleteMapping("/administrators/{id}")
    fun disable(@PathVariable id: UUID,@RequestParam expectedVersion: Long,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.admin(true);return commands.run(actor,key,"DISABLE_ADMIN:$id",expectedVersion,MutationResult::class.java,request.requestId()) { service.disable(id,expectedVersion) }
    }
    @GetMapping("/users")
    fun users(@RequestParam(required=false) keyword: String?,@RequestParam(required=false) collegeId: UUID?,@RequestParam(required=false) majorId: UUID?,@RequestParam(required=false) status: String?,
              @RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<UserView> {
        sessions.admin(true);val p=PageSpec(page,pageSize)
        return service.listUsers(keyword,collegeId,majorId,status,p)
    }
    @GetMapping("/users/{id}") fun user(@PathVariable id: UUID): UserView { sessions.admin(true);return service.user(id) }
    @PutMapping("/users/{id}/status")
    fun userStatus(@PathVariable id: UUID,@RequestBody input: AccountStatusInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.admin(true);return commands.run(actor,key,"USER_STATUS:$id",input,MutationResult::class.java,request.requestId()) { service.userStatus(id,input) }
    }
    @GetMapping("/security-policy") fun policy(): PolicyView { sessions.admin(true);return service.policy() }
    @PutMapping("/security-policy")
    fun policy(@RequestBody input: PolicyInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): PolicyView {
        val actor=sessions.admin(true);return commands.run(actor,key,"SECURITY_POLICY",input,PolicyView::class.java,request.requestId()) { service.policy(input) }
    }
    @GetMapping("/audit-logs") fun logs(@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): Page<AuditView> {
        sessions.admin(true);val p=PageSpec(page,pageSize)
        return service.auditLogs(p)
    }
}
