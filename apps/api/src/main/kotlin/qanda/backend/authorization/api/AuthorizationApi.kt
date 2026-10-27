package qanda.backend.authorization.api

import com.fasterxml.jackson.annotation.JsonProperty
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import java.time.Instant
import java.util.UUID

const val MAX_VERSION: Long = 9007199254740991L
enum class OrganizationStatus { ACTIVE, DISABLED }
enum class GuardMode { SHARE, UPDATE }
enum class SubjectSource { SCHOOL, USER }
enum class AccessAction {
    CREATE, READ_CURRENT_CONTENT, SELECT_WRONG_REVIEW,
    CONTINUE_FIXED_SESSION, READ_FIXED_SESSION_RESULT, READ_LEARNING_HISTORY,
    EDIT_USER_CONTENT, MANAGE_USER_SHARES, MANAGE_SCHOOL_CONTENT
}

data class College(val collegeId: UUID, val name: String, val status: OrganizationStatus, val version: Long, val createdAt: Instant, val updatedAt: Instant)
data class Major(val majorId: UUID, val collegeId: UUID, val name: String, val status: OrganizationStatus, val version: Long, val createdAt: Instant, val updatedAt: Instant)
data class CollegeOption(val collegeId: UUID, val name: String)
data class MajorOption(val majorId: UUID, val collegeId: UUID, val name: String)
data class Page<T>(val items: List<T>, val page: Int, val pageSize: Int, val totalItems: Long)
data class PolicyPage<T>(val items: List<T>, val page: Int, val pageSize: Int, val totalItems: Long, val version: Long)
data class Membership(val accountId: UUID, val collegeId: UUID, val collegeName: String, val majorId: UUID, val majorName: String, val organizationActive: Boolean, val version: Long, val establishedAt: Instant, val updatedAt: Instant)
data class MembershipView(val membership: Membership?)
data class MembershipSummary(val accountId: UUID, val membership: Membership?)
data class MembershipSnapshot(val accountId: UUID, val collegeId: UUID, val collegeName: String, val majorId: UUID, val majorName: String)
data class MembershipChange(val changeId: UUID, val accountId: UUID, val fromMajorId: UUID?, val toMajorId: UUID, val actorAccountId: UUID, val reason: String, val changedAt: Instant, val resultingVersion: Long)
data class SchoolPolicy(val subjectId: UUID, val isPublic: Boolean, val version: Long, val updatedAt: Instant)
data class CollegeGrant(val subjectId: UUID, val collegeId: UUID, val grantedByAccountId: UUID, val grantedAt: Instant)
data class MajorGrant(val subjectId: UUID, val majorId: UUID, val grantedByAccountId: UUID, val grantedAt: Instant)
data class SchoolAccountRule(val subjectId: UUID, val accountId: UUID, val granted: Boolean, val inheritanceBlocked: Boolean, val updatedByAccountId: UUID, val updatedAt: Instant)
data class UserSubjectShare(val subjectId: UUID, val recipientAccountId: UUID, val recipientAccountCode: String, val recipientNickname: String, val grantedAt: Instant)
data class SchoolAccessExplanation(val subjectId: UUID, val subjectName: String, val accessGranted: Boolean, val accountActive: Boolean, val hasMembership: Boolean, val organizationActive: Boolean, val publicGranted: Boolean, val collegeGranted: Boolean, val majorGranted: Boolean, val explicitGranted: Boolean, val inheritanceBlocked: Boolean, val policyVersion: Long, val newSelectionAvailable: Boolean, val issuedVersionReadAvailable: Boolean)
data class ChangeReceipt(val commandId: UUID, val resourceId: UUID, val version: Long, val changed: Boolean, val confirmedAt: Instant)

data class CreateOrganization(val name: String, val status: OrganizationStatus = OrganizationStatus.ACTIVE)
data class UpdateOrganization(val name: String, val status: OrganizationStatus, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)
data class SetMembership(val collegeId: UUID, val majorId: UUID, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long?)
data class SetPublic(@param:JsonProperty(required = true) val isPublic: Boolean, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)
data class SetOrganizationGrant(@param:JsonProperty(required = true) val enabled: Boolean, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)
data class SetSchoolAccountRule(@param:JsonProperty(required = true) val granted: Boolean, @param:JsonProperty(required = true) val inheritanceBlocked: Boolean, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)
data class GrantUserShare(val accountCode: String, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)
data class RevokeUserShare(val recipientAccountId: UUID, @param:JsonProperty(required = true) @field:Min(1) @field:Max(MAX_VERSION) val expectedVersion: Long)

// Consumer projections carry no credentials or duplicate persistence ownership.
data class AuthorizationActor(val accountId: UUID, val sessionId: UUID)
interface RegistrationIdentityProof { val accountId: UUID; fun assertCurrentTransaction() }
interface AuthorizationAdminContext { val actorAccountId: UUID; fun assertCurrentTransaction() }
interface AuthorizationAccountGuards {
    fun assertHeld(accountId: UUID, mode: GuardMode = GuardMode.SHARE)
    fun isActive(accountId: UUID): Boolean
}
interface AuthorizationSubjectGuard { val subjectId: UUID; fun assertHeld(mode: GuardMode = GuardMode.SHARE) }
data class SubjectAccessDescriptor(val id: UUID, val source: SubjectSource, val ownerAccountId: UUID?, val status: String, val newSelectionAvailable: Boolean, val issuedVersionReadAvailable: Boolean, val ownerManagementAvailable: Boolean, val contentVersion: Long)
data class AccessVerdict(val subjectId: UUID, val source: SubjectSource, val action: AccessAction, val accessGranted: Boolean, val resourceAllowedForAction: Boolean, val allowed: Boolean, val denialKind: String?, val reason: String, val policyVersion: Long, val contentVersion: Long)
data class Recipient(val accountId: UUID, val accountCode: String, val nickname: String)
data class AuthorizationAuditChange(val field: String, val beforeValue: String?, val afterValue: String?)
data class AuthorizationAuditFact(val eventId: UUID, val actorAccountId: UUID, val action: String, val targetType: String, val targetId: UUID, val changes: List<AuthorizationAuditChange>)
data class MembershipInitialization(val snapshot: MembershipSnapshot, val version: Long, val auditFact: AuthorizationAuditFact)

interface MembershipOperations {
    fun prepareMembershipSelectionInTransaction(collegeId: UUID, majorId: UUID, identityGuard: RegistrationIdentityProof): SelectionGuard
    fun initializeMembershipInTransaction(accountId: UUID, collegeId: UUID, majorId: UUID, actorAccountId: UUID, selectionGuard: SelectionGuard, now: Instant): MembershipInitialization
    fun readMembershipSummariesInTransaction(accountIds: List<UUID>, adminContext: AuthorizationAdminContext): List<MembershipSummary>
}

class SelectionGuard internal constructor(
    val accountId: UUID, val college: College, val major: Major,
    internal val transactionConnection: Any,
)
class OrganizationGuards internal constructor(val accountId: UUID, val membership: Membership?, internal val transactionConnection: Any)
class OwnedShareReadProof internal constructor(val ownerAccountId: UUID, val subjectId: UUID, val recipientAccountIds: List<UUID>, internal val transactionToken: Any, private val connectionProvider: () -> Any) {
    internal val transactionConnection: Any get() = connectionProvider()
}

/** Owned by authorization; all parameter values are binds, never caller-supplied SQL. */
class AuthorizedSubjectScope internal constructor(val predicate: String, val parameters: List<Any>, val action: AccessAction)
