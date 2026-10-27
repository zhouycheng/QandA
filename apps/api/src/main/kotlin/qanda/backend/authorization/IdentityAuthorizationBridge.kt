package qanda.backend.authorization

import org.springframework.stereotype.Component
import qanda.backend.authorization.api.RegistrationIdentityProof
import qanda.backend.authorization.api.SelectionGuard
import qanda.backend.authorization.api.OwnedShareReadProof
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.api.AccountGuard
import qanda.backend.identity.api.IdentityMembershipPort
import qanda.backend.identity.api.IdentityShareProjectionPort
import qanda.backend.identity.api.LockMode
import qanda.backend.identity.api.MembershipSelection
import qanda.backend.identity.api.OwnedSharePurpose
import java.time.Instant
import java.util.UUID

/** Recipient projections are minted only from this module's guarded share query. */
class IdentityOwnedSharePurpose internal constructor(internal val proof:OwnedShareReadProof):OwnedSharePurpose

@Component
class IdentityAuthorizationBridge(private val service:AuthorizationService,private val guards:IdentityGuards):IdentityMembershipPort,IdentityShareProjectionPort {
    private class Selection(override val transactionId:UUID,override val accountId:UUID,override val collegeId:UUID,override val majorId:UUID,val delegate:SelectionGuard):MembershipSelection
    override fun prepareMembershipSelectionInTransaction(collegeId:UUID,majorId:UUID,identityGuard:AccountGuard):MembershipSelection {
        guards.assertAccountGuard(identityGuard,LockMode.UPDATE)
        guards.advanceLockPhaseInTransaction(20)
        val proof=object:RegistrationIdentityProof {
            override val accountId=identityGuard.accountId
            override fun assertCurrentTransaction()=guards.assertAccountGuard(identityGuard,LockMode.UPDATE)
        }
        return Selection(identityGuard.transactionId,identityGuard.accountId,collegeId,majorId,service.prepareMembershipSelectionInTransaction(collegeId,majorId,proof))
    }
    override fun initializeMembershipInTransaction(accountId:UUID,collegeId:UUID,majorId:UUID,selection:MembershipSelection,now:Instant):qanda.backend.identity.api.MembershipInitialization {
        val current=selection as? Selection ?: error("Unknown membership selection capability")
        guards.assertCurrentTransaction(current.transactionId)
        check(current.accountId==accountId && current.collegeId==collegeId && current.majorId==majorId)
        val initialized=service.initializeMembershipInTransaction(accountId,collegeId,majorId,accountId,current.delegate,now)
        return qanda.backend.identity.api.MembershipInitialization(initialized.version,qanda.backend.identity.api.MembershipAudit(
            accountId=accountId,collegeId=collegeId,majorId=majorId,eventId=initialized.auditFact.eventId,version=initialized.version))
    }
    override fun validateOwnedShareProjectionInTransaction(purpose:OwnedSharePurpose,accountIds:List<UUID>,transactionId:UUID) {
        guards.assertCurrentTransaction(transactionId)
        val current=purpose as? IdentityOwnedSharePurpose ?: error("Unknown owned-share purpose")
        service.validateOwnedShareReadProofInTransaction(current.proof,accountIds)
    }
}
