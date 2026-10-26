package qanda.backend.identity.api

import java.time.Instant
import java.util.UUID

enum class AccountStatus { ACTIVE, DISABLED }
enum class LockMode { SHARE, UPDATE }
enum class ClientType { WEB, MINI_PROGRAM, ADMIN_WEB }
data class AuthContext(val accountId: UUID, val sessionId: UUID, val credentialVersion: Long)
data class AccountLock(val accountId: UUID, val mode: LockMode = LockMode.SHARE)
data class SessionLock(val sessionId: UUID, val mode: LockMode = LockMode.SHARE)

class AccountGuard internal constructor(
    val transactionId: UUID, val accountId: UUID, val mode: LockMode,
    val status: AccountStatus, val version: Long, val credentialVersion: Long,
)
class SessionGuard internal constructor(
    val transactionId: UUID, val sessionId: UUID, val mode: LockMode,
    val accountId: UUID, val credentialVersion: Long, val expiresAt: Instant, val revokedAt: Instant?,
)
class AccountGuards internal constructor(val transactionId: UUID, val accounts: Map<UUID, AccountGuard>) {
    operator fun get(id: UUID): AccountGuard = accounts[id] ?: error("Account was not prelocked")
}
class SessionGuards internal constructor(val transactionId: UUID, val sessions: Map<UUID, SessionGuard>) {
    operator fun get(id: UUID): SessionGuard = sessions[id] ?: error("Session was not prelocked")
}
class GuardedActor internal constructor(val auth: AuthContext, val account: AccountGuard, val session: SessionGuard) {
    val transactionId: UUID get() = account.transactionId
}

data class RegistrationResult(val accountId: UUID, val accountCode: String, val version: Long)
data class ProfileEditResult(val accountId: UUID, val version: Long)
data class Recipient(val accountId: UUID, val accountCode: String, val nickname: String)
data class AccountProfile(
    val accountId: UUID, val accountCode: String, val nickname: String, val status: AccountStatus,
    val version: Long, val createdAt: Instant, val updatedAt: Instant,
    val email: String?, val emailVerifiedAt: Instant?, val passwordSet: Boolean, val wechatBound: Boolean,
)
data class Me(val profile: AccountProfile, val adminEligible: Boolean)
data class EmailChallenge(val challengeId: UUID, val expiresAt: Instant, val nextSendAt: Instant)
data class EmailChange(
    val emailChangeId: UUID, val oldChallengeId: UUID, val newChallengeId: UUID,
    val oldEmailMasked: String, val newEmailMasked: String, val expiresAt: Instant,
    val nextSendAt: Instant, val expectedVersion: Long,
)
sealed interface WechatAuthResult
class TokenGrant(
    val accessToken: String, val sessionId: UUID, val accountId: UUID, val expiresAt: Instant,
) : WechatAuthResult {
    val kind = "SESSION_GRANTED"
    val tokenType = "Bearer"
}
class RegistrationRequired(val registrationToken: String, val expiresAt: Instant) : WechatAuthResult {
    val kind = "REGISTRATION_REQUIRED"
}
data class SessionInfo(
    val sessionId: UUID, val clientType: ClientType, val deviceId: UUID, val issuedAt: Instant,
    val expiresAt: Instant, val lastSeenAt: Instant, val current: Boolean,
)
data class Page<T>(val items: List<T>, val page: Int, val pageSize: Int, val totalItems: Long)
data class PageSpec(val page: Int = 1, val pageSize: Int = 20)
data class AccountSummary(
    val accountId: UUID, val accountCode: String, val nickname: String, val status: AccountStatus,
    val maskedEmail: String?, val createdAt: Instant, val accountVersion: Long,
)
data class AccountFilters(val accountCode: String? = null, val nicknameContains: String? = null, val status: AccountStatus? = null)
data class StatusChange(val field: String, val beforeValue: String, val afterValue: String)
data class AccountStatusMutationResult(
    val accountId: UUID, val status: AccountStatus, val accountVersion: Long,
    val credentialVersion: Long, val changed: Boolean, val auditChanges: List<StatusChange>,
)
data class IdentityMailEligibility(val eligible: Boolean, val reasonCode: String)
enum class VerifiedEmailPurpose { IDENTITY_CREDENTIAL_VERIFICATION }
data class VerifiedEmailState(val accountId: UUID, val status: AccountStatus, val email: String?, val verifiedAt: Instant?)
class PreparedPassword internal constructor(internal val encoded: String) {
    override fun toString() = "PreparedPassword([REDACTED])"
}

/** Q04 supplies the implementation; this capability is never an HTTP input. */
interface MembershipSelection {
    val transactionId: UUID
    val accountId: UUID
    val collegeId: UUID
    val majorId: UUID
}
data class MembershipInitialization(val version: Long, val audit: MembershipAudit)
data class MembershipAudit(val accountId: UUID, val collegeId: UUID, val majorId: UUID, val eventId: UUID, val version: Long)
interface IdentityMembershipPort {
    fun prepareMembershipSelectionInTransaction(collegeId: UUID, majorId: UUID, identityGuard: AccountGuard): MembershipSelection
    fun initializeMembershipInTransaction(accountId: UUID, collegeId: UUID, majorId: UUID, selection: MembershipSelection, now: Instant): MembershipInitialization
}

/** Identity domain outcomes; Q12 maps these to its single canonical AuditFact model. */
data class IdentityEvent(
    val eventId: UUID = UUID.randomUUID(), val action: String, val actorAccountId: UUID?,
    val targetType: String, val targetId: UUID?, val changes: List<StatusChange> = emptyList(),
)
interface IdentityAuditPort {
    fun appendIdentityAuditInTransaction(events: List<IdentityEvent>, membership: MembershipAudit?, requestId: UUID, now: Instant, transactionId: UUID)
}

/** Q12 owns and validates these opaque capabilities, including L14 guards/last-admin policy. */
interface AdministrationProof
interface StatusMutationProof : AdministrationProof
interface QualifiedAccountScope
enum class AccountProjectionPurpose { ADMIN_ACCOUNT_SUMMARY, ADMIN_MINIMAL_LABELS }
interface IdentityAdministrationPort {
    fun hasAdminQualificationInTransaction(actor: GuardedActor): Boolean
    fun validateAdministrationInTransaction(proof: AdministrationProof, purpose: AccountProjectionPurpose)
    fun validateStatusMutationInTransaction(proof: StatusMutationProof, targetAccountId: UUID, status: AccountStatus)
    fun validateQualifiedScopeInTransaction(scope: QualifiedAccountScope, proof: AdministrationProof, mutation: StatusMutationProof)
}

/** Q04 must verify the current owner/subject/share references, without acquiring earlier locks. */
interface OwnedSharePurpose
interface IdentityShareProjectionPort {
    fun validateOwnedShareProjectionInTransaction(purpose: OwnedSharePurpose, accountIds: List<UUID>, transactionId: UUID)
}

class WechatIdentity(val appId: String, val openId: String, val unionId: String?) {
    override fun toString() = "WechatIdentity([REDACTED])"
}
interface WechatCodeExchange { fun exchange(code: String): WechatIdentity }
