package qanda.backend.identity

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID

data class ChallengeInput(@field:Schema(allowableValues=["REGISTER","RESET_PASSWORD","BIND_EMAIL","CHANGE_EMAIL_NEW","CHANGE_EMAIL_OLD","CHANGE_PASSWORD"]) val purpose: String, val email: String? = null)
data class ChallengeView(val id: UUID, val expiresAt: Instant, val resendAfterSeconds: Int = 60)
data class RegistrationInput(val challengeId: UUID, @field:Schema(pattern="^[0-9]{6}$") val code: String, val password: String, val nickname: String = "Q友")
data class WechatRegistrationInput(val registrationToken: String, val nickname: String = "Q友")
data class LoginInput(val email: String, val password: String, val deviceId: UUID, @field:Schema(allowableValues=["WEB","MINI_PROGRAM"]) val clientType: String = "WEB")
data class WechatLoginInput(val code: String, val deviceId: UUID)
data class TokenView(val accessToken: String, val sessionId: UUID, val expiresAt: Instant)
data class WechatLoginView(val session: TokenView? = null, val registrationToken: String? = null)
data class UserView(val id: UUID, val accountCode: String, val nickname: String, val email: String?, val wechatBound: Boolean,
                    val collegeId: UUID?, val majorId: UUID?, val enrollmentYear: Int?, val status: String, val version: Long, val registeredAt: Instant)
data class ProfileInput(val expectedVersion: Long, val nickname: String, val collegeId: UUID? = null, val majorId: UUID? = null, val enrollmentYear: Int? = null)
data class ResetPasswordInput(val challengeId: UUID, @field:Schema(pattern="^[0-9]{6}$") val code: String, val newPassword: String)
data class PasswordInput(val expectedVersion: Long, val challengeId: UUID, @field:Schema(pattern="^[0-9]{6}$") val code: String, val newPassword: String)
data class EmailInput(val expectedVersion: Long, val newChallengeId: UUID, @field:Schema(pattern="^[0-9]{6}$") val newCode: String, val oldChallengeId: UUID? = null, @field:Schema(pattern="^[0-9]{6}$") val oldCode: String? = null)
data class WechatBindingInput(val expectedVersion: Long, val code: String)
data class SessionView(val id: UUID, val deviceId: UUID, val clientType: String, val issuedAt: Instant, val expiresAt: Instant, val current: Boolean)
