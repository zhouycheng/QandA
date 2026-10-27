package qanda.backend.identity

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.web.bind.annotation.*
import org.springframework.web.filter.OncePerRequestFilter
import qanda.backend.identity.api.*
import qanda.backend.platform.http.*
import java.time.Clock
import java.util.UUID

@Configuration
class IdentitySecurity {
    @Bean
    @Order(0)
    fun identityChain(http: HttpSecurity, guards: IdentityGuards, clock: Clock, errors: ErrorWriter, mapper: ObjectMapper): SecurityFilterChain = http
        .securityMatcher("/api/v1/**").csrf { it.disable() }.requestCache { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .authorizeHttpRequests { rules ->
            rules.requestMatchers(org.springframework.http.HttpMethod.POST,*PUBLIC_PATHS.toTypedArray()).permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.GET,"/api/v1/colleges","/api/v1/colleges/*/majors").permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.DELETE,"/api/v1/auth/sessions/current").permitAll().anyRequest().authenticated()
        }
        .exceptionHandling {
            it.authenticationEntryPoint { req,res,_ -> errors.write(req,res,ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请提供有效令牌")) }
            it.accessDeniedHandler { req,res,_ -> errors.write(req,res,ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","无权执行此操作")) }
        }
        .addFilterBefore(object : OncePerRequestFilter() {
            override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
                response.setHeader("Cache-Control","no-store")
                val optional = request.method == "DELETE" && request.requestURI == "/api/v1/auth/sessions/current"
                val public = (request.method == "POST" && request.requestURI in PUBLIC_PATHS) ||
                    (request.method == "GET" && (request.requestURI == "/api/v1/colleges" || request.requestURI.matches(Regex("/api/v1/colleges/[^/]+/majors"))))
                try {
                    if (identityPath(request.requestURI) && request.contentLengthLong > 16384) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"PAYLOAD_TOO_LARGE","身份请求过大")
                    if (identityPath(request.requestURI) && request.contentType?.substringBefore(';')?.trim()?.equals("application/json",true) == true && RequestBodies.bytes(request).size > 16384) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"PAYLOAD_TOO_LARGE","身份请求过大")
                    if (!public) {
                        val headers = request.getHeaders("Authorization").toList()
                        val raw = headers.singleOrNull()?.let { Regex("(?i:Bearer) ([A-Za-z0-9_-]{43})").matchEntire(it)?.groupValues?.get(1) }
                        val auth = try { if (raw == null) unauthenticated() else guards.authenticate(raw,clock.instant()) }
                            catch (error: ApiException) { if (optional && error.status == HttpStatus.UNAUTHORIZED) null else throw error }
                        if (auth != null) SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(auth,null,emptyList())
                    }
                    if (identityPath(request.requestURI) && request.requestURI != "/api/v1/me/sessions" && request.parameterMap.isNotEmpty())
                        throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST","该操作不接受查询参数")
                    if (identityPath(request.requestURI) && request.method in setOf("POST","PUT","PATCH") && request.contentType?.substringBefore(';')?.trim()?.equals("application/json",true) == true) {
                        val input = try { mapper.readTree(RequestBodies.bytes(request)) } catch (_: Exception) { throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST","请求JSON格式不符合要求") }
                        if (input == null || !input.isObject) throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST","请求JSON必须为对象")
                        for ((field,value) in input.properties()) {
                            if (field == "expectedVersion" && (!value.isIntegralNumber || !value.canConvertToLong())) invalid(field)
                            if (field == "rememberMe" && !value.isBoolean) invalid(field)
                            if (field in STRING_FIELDS && !value.isTextual) invalid(field)
                            if (field in UUID_FIELDS && runCatching { UUID.fromString(value.asText()).toString() == value.asText().lowercase(java.util.Locale.ROOT) }.getOrDefault(false) != true) invalid(field)
                        }
                    }
                    chain.doFilter(request,response)
                } catch (error: ApiException) {
                    error.details?.retryAfterSeconds?.let { response.setHeader("Retry-After",it.toString()) }
                    errors.write(request,response,error)
                } catch (_: org.springframework.dao.DataAccessException) {
                    errors.write(request,response,ApiException(HttpStatus.SERVICE_UNAVAILABLE,"IDENTITY_UNAVAILABLE","身份服务暂时不可用"))
                } finally { SecurityContextHolder.clearContext() }
            }
        },UsernamePasswordAuthenticationFilter::class.java).build()
    companion object {
        val PUBLIC_PATHS = setOf("/api/v1/auth/email-challenges","/api/v1/auth/email-registrations","/api/v1/auth/wechat-registrations","/api/v1/auth/sessions","/api/v1/auth/wechat-sessions","/api/v1/auth/password-resets")
        private val STRING_FIELDS = setOf("purpose","email","challengeId","code","password","collegeId","majorId","nickname","registrationToken","clientType","deviceId","newPassword","newEmail","oldCode","newCode")
        private val UUID_FIELDS = setOf("challengeId","collegeId","majorId","deviceId")
        fun identityPath(path: String) = path in PUBLIC_PATHS || path == "/api/v1/me" || path == "/api/v1/me/profile" || path.startsWith("/api/v1/me/email-") || path == "/api/v1/me/password" || path == "/api/v1/me/wechat-binding" || path == "/api/v1/me/sessions" || path.startsWith("/api/v1/me/sessions/") || path.startsWith("/api/v1/accounts/by-code/")
    }
}

class PublicChallengeInput(val purpose: String, val email: String)
class EmailRegistrationInput(val challengeId: UUID, val code: String, val password: String, val collegeId: UUID, val majorId: UUID, val nickname: String = "Q友")
class WechatRegistrationInput(val registrationToken: String, val collegeId: UUID, val majorId: UUID, val nickname: String = "Q友")
class EmailSessionInput(val email: String, val password: String, val clientType: ClientType, val deviceId: UUID, val rememberMe: Boolean = false)
class WechatSessionInput(val code: String, val clientType: ClientType, val deviceId: UUID)
class PasswordResetInput(val challengeId: UUID, val code: String, val newPassword: String)
class ProfileInput(val expectedVersion: Long, val nickname: String)
class OwnChallengeInput(val purpose: String, val email: String? = null)
class BindEmailInput(val challengeId: UUID, val code: String, val expectedVersion: Long)
class PasswordInput(val challengeId: UUID, val code: String, val newPassword: String, val expectedVersion: Long)
class EmailChangeInput(val newEmail: String, val expectedVersion: Long)
class EmailConfirmationInput(val oldCode: String, val newCode: String, val expectedVersion: Long)
class WechatBindingInput(val code: String, val expectedVersion: Long)

@RestController
@RequestMapping("/api/v1")
class IdentityController(private val service: IdentityService, private val mapper: ObjectMapper) {
    private fun actor(): AuthContext = SecurityContextHolder.getContext().authentication?.principal as? AuthContext ?: unauthenticated()
    private fun requestId(request: HttpServletRequest) = RequestIds.get(request)
    private fun command(operation: String, req: HttpServletRequest, res: HttpServletResponse): IdentityCommand {
        val value = req.getHeaders("Idempotency-Key").toList().singleOrNull() ?: throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_IDEMPOTENCY_KEY","请提供一个有效的幂等键")
        val id = runCatching { UUID.fromString(value) }.getOrNull()?.takeIf { it.toString() == value }
            ?: throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_IDEMPOTENCY_KEY","请提供一个有效的幂等键")
        res.setHeader("Idempotency-Key",value)
        return IdentityCommand(operation,id,requestId(req),req.method,req.requestURI,req.contentType,RequestBodies.bytes(req))
    }
    @PostMapping("/auth/email-challenges",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityRequestPublicEmailChallenge(@RequestBody input: PublicChallengeInput, req: HttpServletRequest) = service.requestPublicEmailChallenge(input.purpose,input.email,req.remoteAddr,requestId(req))
    @PostMapping("/auth/email-registrations",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityRegisterEmail(@RequestBody input: EmailRegistrationInput, req: HttpServletRequest, res: HttpServletResponse) = service.registerEmail(input.challengeId,input.code,input.password,input.nickname,input.collegeId,input.majorId,command("identityRegisterEmail",req,res))
    @PostMapping("/auth/wechat-registrations",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityRegisterWechat(@RequestBody input: WechatRegistrationInput, req: HttpServletRequest, res: HttpServletResponse) = service.registerWechat(input.registrationToken,input.nickname,input.collegeId,input.majorId,command("identityRegisterWechat",req,res))
    @PostMapping("/auth/sessions",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityCreateEmailSession(@RequestBody input: EmailSessionInput, req: HttpServletRequest) = service.createEmailSession(input.email,input.password,input.clientType,input.deviceId,input.rememberMe,req.remoteAddr,requestId(req))
    @PostMapping("/auth/wechat-sessions",consumes=["application/json"])
    fun identityCreateWechatSession(@RequestBody input: WechatSessionInput, req: HttpServletRequest) = service.createWechatSession(input.code,input.clientType,input.deviceId,req.remoteAddr,requestId(req))
    @PostMapping("/auth/password-resets",consumes=["application/json"]) @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityResetPassword(@RequestBody input: PasswordResetInput, req: HttpServletRequest, res: HttpServletResponse) = service.resetPassword(input.challengeId,input.code,input.newPassword,command("identityResetPassword",req,res))
    @DeleteMapping("/auth/sessions/current") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityLogout(req: HttpServletRequest) = service.logout(SecurityContextHolder.getContext().authentication?.principal as? AuthContext,requestId(req))
    @GetMapping("/me") fun identityGetMe() = service.getMe(actor())
    @PatchMapping("/me/profile",consumes=["application/json"])
    fun identityUpdateProfile(@RequestBody input: ProfileInput, req: HttpServletRequest, res: HttpServletResponse) = service.updateProfile(actor(),input.expectedVersion,input.nickname,command("identityUpdateProfile",req,res))
    @PostMapping("/me/email-challenges",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityRequestOwnEmailChallenge(@RequestBody input: OwnChallengeInput, req: HttpServletRequest): EmailChallenge {
        if (input.purpose == "CHANGE_PASSWORD" && mapper.readTree(RequestBodies.bytes(req)).has("email")) invalid("email")
        return service.requestOwnEmailChallenge(actor(),input.purpose,input.email,req.remoteAddr,requestId(req))
    }
    @PutMapping("/me/email-binding",consumes=["application/json"]) @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityBindEmail(@RequestBody input: BindEmailInput, req: HttpServletRequest, res: HttpServletResponse) = service.bindEmail(actor(),input.challengeId,input.code,input.expectedVersion,command("identityBindEmail",req,res))
    @PutMapping("/me/password",consumes=["application/json"]) @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityChangePassword(@RequestBody input: PasswordInput, req: HttpServletRequest, res: HttpServletResponse) = service.changePassword(actor(),input.challengeId,input.code,input.newPassword,input.expectedVersion,command("identityChangePassword",req,res))
    @PostMapping("/me/email-changes",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun identityRequestEmailChange(@RequestBody input: EmailChangeInput, req: HttpServletRequest, res: HttpServletResponse) = service.requestEmailChange(actor(),input.newEmail,input.expectedVersion,req.remoteAddr,command("identityRequestEmailChange",req,res))
    @PostMapping("/me/email-changes/{emailChangeId}/confirmations",consumes=["application/json"]) @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityConfirmEmailChange(@PathVariable emailChangeId: UUID, @RequestBody input: EmailConfirmationInput, req: HttpServletRequest, res: HttpServletResponse) = service.confirmEmailChange(actor(),emailChangeId,input.oldCode,input.newCode,input.expectedVersion,command("identityConfirmEmailChange",req,res))
    @PutMapping("/me/wechat-binding",consumes=["application/json"]) @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityBindWechat(@RequestBody input: WechatBindingInput, req: HttpServletRequest, res: HttpServletResponse) = service.bindWechat(actor(),input.code,input.expectedVersion,command("identityBindWechat",req,res))
    @GetMapping("/me/sessions")
    fun identityListSessions(@RequestParam(defaultValue="1") page: Int, @RequestParam(defaultValue="20") pageSize: Int, req: HttpServletRequest): Page<SessionInfo> {
        if (req.parameterMap.keys.any { it !in setOf("page","pageSize") } || req.parameterMap.values.any { it.size != 1 }) invalid("page")
        return service.listSessions(actor(),page,pageSize)
    }
    @DeleteMapping("/me/sessions/{sessionId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun identityRevokeSession(@PathVariable sessionId: UUID, req: HttpServletRequest) = service.revokeSession(actor(),sessionId,requestId(req))
    @GetMapping("/accounts/by-code/{accountCode}")
    fun identityResolveShareRecipient(@PathVariable accountCode: String, req: HttpServletRequest) = service.resolveRecipient(actor(),accountCode,req.remoteAddr,requestId(req))
}

@RestControllerAdvice(assignableTypes=[IdentityController::class])
@Order(Ordered.HIGHEST_PRECEDENCE)
class IdentityErrorHeaders {
    @ExceptionHandler(ApiException::class)
    fun business(error: ApiException, request: HttpServletRequest): ResponseEntity<ApiError> {
        val response = ResponseEntity.status(error.status)
        error.details?.retryAfterSeconds?.let { response.header("Retry-After",it.toString()) }
        return response.body(error.body(request))
    }
}
