package qanda.backend.adminsecurity.api

import qanda.backend.authorization.api.AuthorizationAdminContext
import qanda.backend.identity.api.*
import java.time.Instant
import java.util.UUID

const val MAX_VERSION = 9007199254740991L

class QualificationGuard internal constructor(
    val transactionId: UUID, val accountId: UUID, val mode: LockMode,
    val qualified: Boolean, val version: Long?,
)
class AdminMutationGuard internal constructor(val transactionId: UUID, internal val accountIds: Set<UUID>) : StatusMutationProof
class AdminContext internal constructor(
    val actor: GuardedActor, val qualificationGuard: QualificationGuard,
    internal val verify: () -> Unit,
) : AdministrationProof, AuthorizationAdminContext {
    val transactionId: UUID get() = actor.transactionId
    override val actorAccountId: UUID get() = actor.auth.accountId
    val actorSessionId: UUID get() = actor.auth.sessionId
    val qualificationVersion: Long get() = qualificationGuard.version!!
    override fun assertCurrentTransaction() = verify()
}
class AdminStatusMutationContext internal constructor(
    val admin: AdminContext, val targetGuard: AccountGuard,
    val mutationGuard: AdminMutationGuard, val status: AccountStatus,
    internal val verify: () -> Unit,
) : StatusMutationProof {
    fun assertCurrentTransaction() = verify()
}
class QualifiedAdminAccountScope internal constructor(
    val transactionId: UUID, internal val verify: () -> Unit,
) : QualifiedAccountScope {
    val relationSql: String get() { verify(); return "SELECT account_id FROM admin_qualification WHERE qualified" }
    fun assertCurrentTransaction() = verify()
}

enum class AuditSource { IDENTITY, AUTHORIZATION, CONTENT, PRACTICE, LEARNING, ANALYTICS, ADMIN_SECURITY }
enum class ActorKind { ACCOUNT, LOCAL_OPERATOR, SYSTEM }
enum class AuditOutcome { SUCCESS, FAILURE }
enum class AuditAction {
    ADMIN_BOOTSTRAPPED, ADMIN_QUALIFICATION_CHANGED, ACCOUNT_STATUS_CHANGED,
    ACCOUNT_REGISTERED, LOGIN_SUCCEEDED, CREDENTIAL_CHANGED, IDENTITY_BOUND, SESSION_REVOKED, AUTH_RATE_LIMITED,
    MEMBERSHIP_CHANGED, ORGANIZATION_CHANGED, SCHOOL_ACCESS_CHANGED, USER_SHARE_CHANGED,
    CONTENT_CHANGED, CONTENT_IMPORT_COMMITTED, PRACTICE_COMPLETED, PRACTICE_RESTRICTED_ARCHIVED,
    STUDENT_RECORDS_READ, ADMIN_SUMMARY_READ, ADMIN_METADATA_READ, AUDIT_READ, SECURITY_REJECTED,
    ANALYTICS_REBUILD_STARTED, ANALYTICS_REBUILD_ACTIVATED, ANALYTICS_REBUILD_FAILED,
}
enum class AuditTarget {
    ACCOUNT, ADMIN_QUALIFICATION, AUTH_SESSION, COLLEGE, MAJOR, MEMBERSHIP, SUBJECT, CHAPTER,
    QUESTION, IMPORT_BATCH, PRACTICE_SESSION, AUDIT_ENTRY, QUERY, SYSTEM, ANALYTICS_GENERATION,
}
enum class AuditField {
    ACCOUNT_STATUS, ADMIN_QUALIFIED, COLLEGE_ID, MAJOR_ID, IS_PUBLIC, RESOURCE_STATUS, RESOURCE_VERSION, CREDENTIAL_VERSION,
}
enum class AuditRecordKind { COMPLETED, RESTRICTED_ARCHIVED }
data class AuditActor(val kind: ActorKind, val accountId: UUID?)
data class AuditChange(val field: AuditField, val beforeValue: String?, val afterValue: String?)
data class AuditFact(
    val sourceModule: AuditSource, val eventId: UUID, val actor: AuditActor, val action: AuditAction,
    val targetType: AuditTarget, val targetId: UUID?, val recordKind: AuditRecordKind? = null,
    val relatedRecordId: UUID? = null, val outcome: AuditOutcome = AuditOutcome.SUCCESS,
    val reasonCode: String? = null, val changes: List<AuditChange> = emptyList(),
)
class ActorProof internal constructor(
    val actor: AuditActor, val transactionId: UUID, internal val verify: () -> Unit,
    internal val localPurpose: String? = null, internal val generationId: UUID? = null,
)
class LocalOperatorProof internal constructor(val purpose: String, val invocationId: UUID)
data class AppendAuditResult(val auditEntryIds: List<UUID>)

interface AdminSecurityOperations {
    fun lockAdminMutationInTransaction(accountGuards: AccountGuards): AdminMutationGuard
    fun lockQualificationsInTransaction(accountGuards: AccountGuards, modes: Map<UUID, LockMode>, mutationGuard: AdminMutationGuard? = null): Map<UUID, QualificationGuard>
    fun requireAdminInTransaction(actor: GuardedActor, accountGuard: AccountGuard, qualificationGuard: QualificationGuard): AdminContext
    fun hasAdminQualificationInTransaction(actor: GuardedActor): Boolean
    fun accountActorInTransaction(actor: GuardedActor): ActorProof
    fun maintenanceActorInTransaction(local: LocalOperatorProof, generationId: UUID): ActorProof
    fun appendAuditInTransaction(facts: List<AuditFact>, proofs: List<ActorProof>, requestId: UUID, now: Instant): AppendAuditResult
}

/** Q03 adapter supplies sole account facts; no production fallback may pretend success. */
interface AdminIdentityPort {
    fun readAccountSummaries(accountIds: List<UUID>, admin: AdminContext): List<AccountSummary>
    fun listAccountSummariesForAdministrationInTransaction(admin: AdminContext, filters: AccountFilters, page: PageSpec): Page<AccountSummary>
    fun countActiveAccountsInTransaction(scope: QualifiedAdminAccountScope, admin: AdminContext, mutation: AdminMutationGuard): Long
    fun setAccountStatus(proof: AdminStatusMutationContext, targetAccountId: UUID, status: AccountStatus, expectedVersion: Long, now: Instant): AccountStatusMutationResult
    fun requestPublicEmailChallenge(email: String): EmailChallenge
    fun prepareLocalBootstrapPassword(rawPassword: String): PreparedPassword
    fun createBootstrapIdentityInTransaction(challengeId: UUID, code: String, prepared: PreparedPassword, nickname: String?, now: Instant): RegistrationResult
    fun recordBootstrapFailure(challengeId: UUID, code: String)
}
