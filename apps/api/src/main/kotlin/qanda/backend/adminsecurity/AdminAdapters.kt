package qanda.backend.adminsecurity

import org.springframework.stereotype.Component
import qanda.backend.adminsecurity.api.*
import qanda.backend.authorization.api.*
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.IdentityService
import qanda.backend.identity.api.*
import java.time.Instant
import java.util.UUID
import qanda.backend.identity.api.Page
import qanda.backend.identity.api.AccountStatus
import qanda.backend.identity.api.LockMode

@Component
class AdminIdentityAdapter(private val provider: IdentityService) : AdminIdentityPort {
    override fun readAccountSummaries(accountIds: List<UUID>,admin: AdminContext)=provider.readAccountSummaries(accountIds,admin)
    override fun listAccountSummariesForAdministrationInTransaction(admin: AdminContext,filters: AccountFilters,page: PageSpec): Page<AccountSummary> = provider.listAccountSummariesForAdministrationInTransaction(admin,filters,page)
    override fun countActiveAccountsInTransaction(scope: QualifiedAdminAccountScope,admin: AdminContext,mutation: AdminMutationGuard)=provider.countActiveAccountsInTransaction(scope,admin,mutation)
    override fun setAccountStatus(proof: AdminStatusMutationContext,targetAccountId: UUID,status: AccountStatus,expectedVersion: Long,now: Instant)=provider.setAccountStatus(proof,targetAccountId,status,expectedVersion,now)
    override fun requestPublicEmailChallenge(email: String)=provider.requestPublicEmailChallenge("REGISTER",email,"local-bootstrap",UUID.randomUUID())
    override fun prepareLocalBootstrapPassword(rawPassword: String)=provider.prepareLocalBootstrapPassword(rawPassword)
    override fun createBootstrapIdentityInTransaction(challengeId: UUID,code: String,prepared: PreparedPassword,nickname: String?,now: Instant)=provider.createBootstrapIdentityInTransaction(challengeId,code,prepared,nickname,now)
    override fun recordBootstrapFailure(challengeId: UUID,code: String)=provider.preflightBootstrapProof(challengeId,code,UUID.randomUUID())
}

@Component
class AdminAuthorizationAdapter(private val access: AdminAccess,private val identity: IdentityGuards) : AuthorizationAdminPort {
    override fun requireAdminInTransaction(actor: AuthorizationActor,accountGuards: AuthorizationAccountGuards): AuthorizationAdminContext {
        val held=accountGuards as? AuthorizationIdentityGuards ?: error("Q03-backed prelocked guards required")
        check(held.actor.auth.accountId==actor.accountId && held.actor.auth.sessionId==actor.sessionId)
        held.assertHeld(actor.accountId)
        val qualification=access.lockQualificationsInTransaction(held.accountGuards,mapOf(actor.accountId to LockMode.SHARE)).getValue(actor.accountId)
        return access.requireAdminInTransaction(held.actor,held.actor.account,qualification)
    }
    override fun appendAuditInTransaction(facts: List<AuthorizationAuditFact>,requestId: UUID,now: Instant) {
        val mapped=facts.map { fact -> AuditFact(AuditSource.AUTHORIZATION,fact.eventId,AuditActor(ActorKind.ACCOUNT,fact.actorAccountId),AuditAction.valueOf(fact.action),AuditTarget.valueOf(fact.targetType),fact.targetId,
            changes=fact.changes.map { AuditChange(AuditField.valueOf(it.field),it.beforeValue,it.afterValue) }) }
        val proofs=facts.map { it.actorAccountId }.distinct().map { access.identityActorInTransaction(identity.existingAccountGuardInTransaction(it)) }
        access.appendAuditInTransaction(mapped,proofs,requestId,now)
    }
}

@Component
class AdminIdentityAuditAdapter(private val access: AdminAccess,private val identity: IdentityGuards) : IdentityAuditPort {
    override fun appendIdentityAuditInTransaction(events: List<IdentityEvent>,membership: MembershipAudit?,requestId: UUID,now: Instant,transactionId: UUID) {
        identity.assertCurrentTransaction(transactionId)
        val facts=events.map { event -> AuditFact(AuditSource.IDENTITY,event.eventId,AuditActor(if(event.actorAccountId==null) ActorKind.SYSTEM else ActorKind.ACCOUNT,event.actorAccountId),AuditAction.valueOf(event.action),AuditTarget.valueOf(event.targetType),event.targetId,
            changes=event.changes.map { AuditChange(AuditField.valueOf(it.field),it.beforeValue,it.afterValue) }) }.toMutableList()
        membership?.let { value -> facts+=AuditFact(AuditSource.AUTHORIZATION,value.eventId,AuditActor(ActorKind.ACCOUNT,value.accountId),AuditAction.MEMBERSHIP_CHANGED,AuditTarget.MEMBERSHIP,value.accountId,
            changes=listOf(AuditChange(AuditField.COLLEGE_ID,null,value.collegeId.toString()),AuditChange(AuditField.MAJOR_ID,null,value.majorId.toString()),AuditChange(AuditField.RESOURCE_VERSION,null,value.version.toString()))) }
        if(facts.isEmpty()) return
        val proofs=facts.map { it.actor }.distinct().map { actor -> if(actor.accountId==null) access.systemActorInTransaction() else access.identityActorInTransaction(identity.existingAccountGuardInTransaction(actor.accountId)) }
        access.appendAuditInTransaction(facts,proofs,requestId,now)
    }
}
