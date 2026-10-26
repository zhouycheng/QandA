package qanda.backend.adminsecurity

import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.adminsecurity.api.*
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock
import java.time.Instant
import java.util.UUID

internal fun bad(code: String = "VALIDATION_FAILED", status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY): Nothing =
    throw ApiException(status, code, "请求条件不符合要求")
internal fun dependency(): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"ADMIN_DEPENDENCY_UNAVAILABLE","管理服务依赖暂不可用")

@Service
class AdminAccess(
    private val jdbc: JdbcTemplate, private val tx: JdbcTransactions,
    private val identity: IdentityGuards, private val audits: AdminAuditStore, private val clock: Clock,
) : AdminSecurityOperations, IdentityAdministrationPort {
    private val key = Any()
    private class State(val id: UUID) {
        var stage = 0
        var mutation: AdminMutationGuard? = null
        val qualifications = linkedMapOf<UUID,QualificationGuard>()
    }
    private fun state(): State {
        val id = identity.currentTransactionId()
        val existing = TransactionSynchronizationManager.getResource(key) as State?
        if (existing != null) { check(existing.id==id); return existing }
        return State(id).also {
            TransactionSynchronizationManager.bindResource(key,it)
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCompletion(status: Int) { TransactionSynchronizationManager.unbindResourceIfPossible(key) }
            })
        }
    }
    internal fun checkActor(actor: GuardedActor) {
        identity.requireActiveForWrite(actor.auth,AccountGuards(actor.transactionId,mapOf(actor.account.accountId to actor.account)),
            SessionGuards(actor.transactionId,mapOf(actor.session.sessionId to actor.session)),clock.instant())
    }
    override fun lockAdminMutationInTransaction(accountGuards: AccountGuards): AdminMutationGuard = tx.mandatory {
        val state=state()
        check(state.stage<=1 && accountGuards.transactionId==state.id)
        accountGuards.accounts.values.forEach { identity.assertAccountGuard(it) }
        identity.advanceLockPhaseInTransaction(14)
        if (state.mutation==null) {
            check(jdbc.queryForList("SELECT singleton_id FROM admin_control WHERE singleton_id=1 FOR UPDATE").size==1) { "Administrator control is missing" }
            state.mutation=AdminMutationGuard(state.id,accountGuards.accounts.keys)
        }
        state.stage=1
        state.mutation!!
    }
    override fun lockQualificationsInTransaction(accountGuards: AccountGuards,modes: Map<UUID,LockMode>,mutationGuard: AdminMutationGuard?): Map<UUID,QualificationGuard> = tx.mandatory {
        val state=state();check(state.stage<=2 && accountGuards.transactionId==state.id)
        identity.advanceLockPhaseInTransaction(14)
        for ((id,mode) in modes.toSortedMap(compareBy { it.toString() })) {
            val account=accountGuards[id];identity.assertAccountGuard(account,mode)
            if(mode==LockMode.UPDATE) check(mutationGuard===state.mutation && mutationGuard!=null && id in mutationGuard.accountIds)
            val held=state.qualifications[id]
            if(held!=null) { check(held.mode==mode || held.mode==LockMode.UPDATE);continue }
            check(state.qualifications.isEmpty() || id.toString()>state.qualifications.keys.last().toString()) { "Qualification guards must be sorted" }
            val lock=if(mode==LockMode.UPDATE) "UPDATE" else "SHARE"
            val row=jdbc.queryForList("SELECT qualified,version FROM admin_qualification WHERE account_id=? FOR $lock",id).singleOrNull()
            state.qualifications[id]=QualificationGuard(state.id,id,mode,row?.get("qualified") as? Boolean ?: false,(row?.get("version") as? Number)?.toLong())
        }
        state.stage=2
        modes.keys.associateWith { state.qualifications.getValue(it) }
    }
    override fun requireAdminInTransaction(actor: GuardedActor,accountGuard: AccountGuard,qualificationGuard: QualificationGuard): AdminContext {
        checkActor(actor);check(accountGuard===actor.account)
        verifyQualification(qualificationGuard)
        check(qualificationGuard.accountId==actor.auth.accountId)
        if(!qualificationGuard.qualified) bad("ADMIN_REQUIRED",HttpStatus.FORBIDDEN)
        lateinit var result: AdminContext
        result=AdminContext(actor,qualificationGuard) { verifyContext(result) }
        return result
    }
    private fun verifyQualification(guard: QualificationGuard) {
        val state=state();check(guard.transactionId==state.id && state.qualifications[guard.accountId]===guard) { "Stale qualification guard" }
    }
    internal fun verifyContext(context: AdminContext) {
        identity.assertCurrentTransaction(context.transactionId)
        identity.assertAccountGuard(context.actor.account)
        verifyQualification(context.qualificationGuard)
        check(context.qualificationGuard.qualified)
    }
    override fun hasAdminQualificationInTransaction(actor: GuardedActor): Boolean {
        checkActor(actor)
        val accounts=AccountGuards(actor.transactionId,mapOf(actor.account.accountId to actor.account))
        return lockQualificationsInTransaction(accounts,mapOf(actor.auth.accountId to LockMode.SHARE))[actor.auth.accountId]!!.qualified
    }
    override fun validateAdministrationInTransaction(proof: AdministrationProof,purpose: AccountProjectionPurpose) {
        verifyContext(proof as? AdminContext ?: error("Unrecognized administrator proof"))
    }
    override fun validateStatusMutationInTransaction(proof: StatusMutationProof,targetAccountId: UUID,status: AccountStatus) {
        val context=proof as? AdminStatusMutationContext ?: error("Unrecognized status mutation proof")
        context.assertCurrentTransaction()
        check(context.targetGuard.accountId==targetAccountId && context.status==status)
    }
    override fun validateQualifiedScopeInTransaction(scope: QualifiedAccountScope,proof: AdministrationProof,mutation: StatusMutationProof) {
        val qualified=scope as? QualifiedAdminAccountScope ?: error("Unrecognized qualified account scope")
        qualified.assertCurrentTransaction();verifyContext(proof as? AdminContext ?: error("Unrecognized administrator proof"))
        val guard=mutation as? AdminMutationGuard ?: error("Unrecognized count mutation guard")
        check(guard===state().mutation && qualified.transactionId==guard.transactionId)
    }
    internal fun qualifiedScope(admin: AdminContext,mutation: AdminMutationGuard): QualifiedAdminAccountScope {
        verifyContext(admin);check(mutation===state().mutation)
        return QualifiedAdminAccountScope(admin.transactionId) { verifyContext(admin);check(mutation===state().mutation) }
    }
    internal fun statusProof(admin: AdminContext,target: AccountGuard,mutation: AdminMutationGuard,status: AccountStatus): AdminStatusMutationContext {
        verifyContext(admin);identity.assertAccountGuard(target,LockMode.UPDATE);check(mutation===state().mutation)
        return AdminStatusMutationContext(admin,target,mutation,status) {
            verifyContext(admin);identity.assertAccountGuard(target,LockMode.UPDATE);check(mutation===state().mutation)
        }
    }
    override fun accountActorInTransaction(actor: GuardedActor): ActorProof {
        checkActor(actor)
        return ActorProof(AuditActor(ActorKind.ACCOUNT,actor.auth.accountId),actor.transactionId,{ identity.assertAccountGuard(actor.account) })
    }
    internal fun identityActorInTransaction(account: AccountGuard): ActorProof {
        identity.assertAccountGuard(account)
        return ActorProof(AuditActor(ActorKind.ACCOUNT,account.accountId),account.transactionId,{ identity.assertAccountGuard(account) })
    }
    internal fun systemActorInTransaction(): ActorProof {
        val id=identity.currentTransactionId()
        return ActorProof(AuditActor(ActorKind.SYSTEM,null),id,{ identity.assertCurrentTransaction(id) })
    }
    override fun maintenanceActorInTransaction(local: LocalOperatorProof,generationId: UUID): ActorProof {
        check(local.purpose=="ANALYTICS_REBUILD")
        return localActor(local,generationId)
    }
    internal fun localActor(local: LocalOperatorProof,targetId: UUID): ActorProof {
        val id=identity.currentTransactionId()
        check(local.purpose in setOf("BOOTSTRAP","ANALYTICS_REBUILD"))
        return ActorProof(AuditActor(ActorKind.LOCAL_OPERATOR,null),id,{ identity.assertCurrentTransaction(id) },local.purpose,targetId)
    }
    override fun appendAuditInTransaction(facts: List<AuditFact>,proofs: List<ActorProof>,requestId: UUID,now: Instant): AppendAuditResult =
        audits.appendAuditInTransaction(facts,proofs,requestId,now)
}
