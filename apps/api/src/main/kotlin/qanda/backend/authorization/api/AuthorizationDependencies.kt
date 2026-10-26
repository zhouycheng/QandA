package qanda.backend.authorization.api

import java.time.Instant
import java.util.UUID

/** Q03 implements this consumer port with its sole identity/session owner. */
interface AuthorizationIdentityPort {
    fun currentActor(): AuthorizationActor
    fun lockAccountsAndSessionInTransaction(actor: AuthorizationActor, modes: Map<UUID, GuardMode>): AuthorizationAccountGuards
    fun resolveRecipient(accountCode: String): Recipient
    fun readRecipientSummariesForOwnedShares(accountIds: List<UUID>, proof: OwnedShareReadProof): List<Recipient>
}

/** Q12 delegates to AS-P01 (L14b) and AS-P03 (L80); no separate roles/audit store. */
interface AuthorizationAdminPort {
    fun requireAdminInTransaction(actor: AuthorizationActor, accountGuards: AuthorizationAccountGuards): AuthorizationAdminContext
    fun appendAuditInTransaction(facts: List<AuthorizationAuditFact>, requestId: UUID, now: Instant)
}

/** Q05 supplies its actual subject guard, metadata and bounded metadata queries in batch B. */
interface AuthorizationContentPort {
    fun lockSubjectInTransaction(subjectId: UUID, mode: GuardMode): AuthorizationSubjectGuard
    fun describeLocked(guard: AuthorizationSubjectGuard): SubjectAccessDescriptor
    fun readSchoolMetadataInTransaction(page: Int, pageSize: Int): Page<Pair<SubjectAccessDescriptor, String>>
}

interface AuthorizationContentReadiness {
    fun requireReadyInTransaction()
}
