package qanda.backend.adminsecurity

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.bind.annotation.*
import org.springframework.web.servlet.HandlerMapping
import qanda.backend.adminsecurity.api.*
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.RequestBodies
import qanda.backend.platform.http.RequestIds
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@RestController
@RequestMapping("/api/v1/admin")
class AdminController(private val service: AdminService,private val clock: Clock) {
    private fun auth()=SecurityContextHolder.getContext().authentication?.principal as? AuthContext
        ?: throw ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请提供有效令牌")
    private fun query(request: HttpServletRequest,allowed: Set<String>) {
        if(request.parameterMap.keys.any { it !in allowed } || request.parameterMap.values.any { it.size!=1 }) bad("INVALID_REQUEST",HttpStatus.BAD_REQUEST)
        @Suppress("UNCHECKED_CAST")
        val variables=request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) as? Map<String,String> ?: emptyMap()
        val uuidValues=variables.values+listOfNotNull(request.getParameter("actorAccountId"),request.getParameter("targetId"),request.getParameter("requestId"))
        if(uuidValues.any { !it.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) }) bad("INVALID_REQUEST",HttpStatus.BAD_REQUEST)
    }
    private fun command(request: HttpServletRequest): AdminCommand {
        query(request,emptySet())
        if(request.parameterMap.isNotEmpty()) bad("INVALID_REQUEST",HttpStatus.BAD_REQUEST)
        val values=request.getHeaders("Idempotency-Key").toList()
        val key=values.singleOrNull()?.takeIf { it.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) }?.let(UUID::fromString) ?: bad("INVALID_REQUEST",HttpStatus.BAD_REQUEST)
        val bytes=RequestBodies.bytes(request)
        if(bytes.size>16384) bad("PAYLOAD_TOO_LARGE",HttpStatus.PAYLOAD_TOO_LARGE)
        return AdminCommand(RequestIds.get(request),key,request.method,request.requestURI,request.contentType,bytes)
    }
    private fun <T> response(value: T): ResponseEntity<T> = ResponseEntity.ok(value)

    @GetMapping("/administrators")
    fun adminSecurityListAdministrators(request: HttpServletRequest,@RequestParam(defaultValue="true") qualified: Boolean,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): ResponseEntity<Page<AdminAccountView>> {
        query(request,setOf("qualified","page","pageSize"));if(request.getParameter("qualified")?.let { it !in setOf("true","false") }==true) bad("INVALID_REQUEST",HttpStatus.BAD_REQUEST)
        return response(service.listAdministrators(auth(),qualified,PageSpec(page,pageSize),RequestIds.get(request)))
    }
    @PutMapping("/administrators/{accountId}/qualification",consumes=["application/json"])
    fun adminSecuritySetQualification(request: HttpServletRequest,@PathVariable accountId: UUID,@RequestBody input: SetQualification)=response(service.setQualification(auth(),accountId,input,command(request)))
    @GetMapping("/users")
    fun adminSecurityListUsers(request: HttpServletRequest,@RequestParam(required=false) accountCode: String?,@RequestParam(required=false) nicknameContains: String?,@RequestParam(required=false) status: AccountStatus?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): ResponseEntity<Page<AdminUserView>> {
        query(request,setOf("accountCode","nicknameContains","status","page","pageSize"));return response(service.listUsers(auth(),AccountFilters(accountCode,nicknameContains,status),PageSpec(page,pageSize),RequestIds.get(request)))
    }
    @GetMapping("/users/{accountId}")
    fun adminSecurityGetUser(request: HttpServletRequest,@PathVariable accountId: UUID): ResponseEntity<AdminUserView> { query(request,emptySet());return response(service.getUser(auth(),accountId,RequestIds.get(request))) }
    @PutMapping("/users/{accountId}/status",consumes=["application/json"])
    fun adminSecuritySetAccountStatus(request: HttpServletRequest,@PathVariable accountId: UUID,@RequestBody input: SetAccountStatus)=response(service.setAccountStatus(auth(),accountId,input,command(request)))
    @GetMapping("/security-policy")
    fun adminSecurityReadPolicy(request: HttpServletRequest): ResponseEntity<AdminSecurityPolicy> { query(request,emptySet());return response(service.readPolicy(auth(),RequestIds.get(request))) }
    @GetMapping("/audit-logs")
    fun adminSecurityListAudit(request: HttpServletRequest,@RequestParam(required=false) from: Instant?,@RequestParam(required=false) to: Instant?,@RequestParam(required=false) actorAccountId: UUID?,@RequestParam(required=false) sourceModule: AuditSource?,@RequestParam(required=false) action: AuditAction?,@RequestParam(required=false) outcome: AuditOutcome?,@RequestParam(required=false) targetType: AuditTarget?,@RequestParam(required=false) targetId: UUID?,@RequestParam(required=false) requestId: UUID?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int): ResponseEntity<Page<AuditEntrySummary>> {
        query(request,setOf("from","to","actorAccountId","sourceModule","action","outcome","targetType","targetId","requestId","page","pageSize"))
        if((from==null)!=(to==null) || (request.getParameter("from")?.endsWith("Z")==false) || (request.getParameter("to")?.endsWith("Z")==false)) bad()
        val end=to ?: clock.instant().truncatedTo(ChronoUnit.MILLIS)
        return response(service.listAudit(auth(),AuditFilters(from ?: end.minus(7,ChronoUnit.DAYS),end,actorAccountId,sourceModule,action,outcome,targetType,targetId,requestId),PageSpec(page,pageSize),RequestIds.get(request)))
    }
    @GetMapping("/audit-logs/{auditEntryId}")
    fun adminSecurityGetAudit(request: HttpServletRequest,@PathVariable auditEntryId: UUID): ResponseEntity<AuditEntryDetail> { query(request,emptySet());return response(service.getAudit(auth(),auditEntryId,RequestIds.get(request))) }
}
