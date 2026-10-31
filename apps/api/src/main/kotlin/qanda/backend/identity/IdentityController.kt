package qanda.backend.identity

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*
import qanda.backend.platform.http.MutationResult
import qanda.backend.platform.security.Commands
import qanda.backend.platform.security.requestId
import java.util.UUID

@RestController
@RequestMapping("/api/v1",produces=["application/json"])
class IdentityController(private val service: IdentityService,private val sessions: Sessions,private val challenges: ChallengeService,private val commands: Commands) {
    @PostMapping("/auth/email-challenges") @ResponseStatus(HttpStatus.CREATED)
    fun requestPublicEmailChallenge(@RequestBody input: ChallengeInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): ChallengeView =
        commands.run(null,key,"AUTH_CHALLENGE",input,ChallengeView::class.java,request.requestId()) { challenges.issue(input,null) }
    @PostMapping("/auth/email-registrations") @ResponseStatus(HttpStatus.CREATED)
    fun registerEmail(@RequestBody input: RegistrationInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult =
        commands.run(null,key,"REGISTER_EMAIL",input,MutationResult::class.java,request.requestId()) { challenges.verify(input.challengeId,input.code);service.register(input) }
    @PostMapping("/auth/wechat-registrations") @ResponseStatus(HttpStatus.CREATED)
    fun registerWechat(@RequestBody input: WechatRegistrationInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult =
        commands.run(null,key,"REGISTER_WECHAT",input,MutationResult::class.java,request.requestId()) { service.registerWechat(input) }
    @PostMapping("/auth/sessions") fun login(@RequestBody input: LoginInput): TokenView = service.login(input)
    @PostMapping("/auth/wechat-sessions") fun wechatLogin(@RequestBody input: WechatLoginInput): WechatLoginView = service.wechatLogin(input)
    @PostMapping("/auth/password-resets")
    fun resetPassword(@RequestBody input: ResetPasswordInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult =
        commands.run(null,key,"RESET_PASSWORD",input,MutationResult::class.java,request.requestId()) { challenges.verify(input.challengeId,input.code);service.reset(input) }
    @GetMapping("/me") fun me(): UserView = service.view(sessions.student().id)
    @PutMapping("/me/profile")
    fun updateProfile(@RequestBody input: ProfileInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.student();return commands.run(actor,key,"UPDATE_PROFILE",input,MutationResult::class.java,request.requestId()) { service.updateProfile(actor,input) }
    }
    @PostMapping("/me/email-challenges")
    fun requestOwnEmailChallenge(@RequestBody input: ChallengeInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): ChallengeView {
        val actor=sessions.student();return commands.run(actor,key,"OWN_CHALLENGE",input,ChallengeView::class.java,request.requestId()) { challenges.issue(input,actor.id) }
    }
    @PutMapping("/me/password")
    fun changePassword(@RequestBody input: PasswordInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.student();return commands.run(actor,key,"CHANGE_PASSWORD",input,MutationResult::class.java,request.requestId()) { challenges.verify(input.challengeId,input.code);service.changePassword(actor,input) }
    }
    @PutMapping("/me/email-binding")
    fun changeEmail(@RequestBody input: EmailInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.student();return commands.run(actor,key,"CHANGE_EMAIL",input,MutationResult::class.java,request.requestId()) {
            challenges.verify(input.newChallengeId,input.newCode);input.oldChallengeId?.let { challenges.verify(it,input.oldCode ?: invalid("oldCode")) };service.changeEmail(actor,input)
        }
    }
    @PutMapping("/me/wechat-binding")
    fun bindWechat(@RequestBody input: WechatBindingInput,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.student();return commands.run(actor,key,"BIND_WECHAT",input,MutationResult::class.java,request.requestId()) { service.bindWechat(actor,input) }
    }
    @GetMapping("/me/sessions") fun listSessions(): List<SessionView> = service.sessions(sessions.student())
    @DeleteMapping("/me/sessions/{id}")
    fun revokeSession(@PathVariable id: UUID,@RequestHeader("Idempotency-Key") key: UUID,request: HttpServletRequest): MutationResult {
        val actor=sessions.student();return commands.run(actor,key,"REVOKE_SESSION:$id",id,MutationResult::class.java,request.requestId()) { service.revoke(actor,id) }
    }
    @DeleteMapping("/auth/sessions/current") fun logout(): MutationResult { val actor=sessions.student();return service.revoke(actor,actor.sessionId) }
}
