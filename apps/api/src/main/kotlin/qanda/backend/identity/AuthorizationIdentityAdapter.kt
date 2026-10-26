package qanda.backend.identity

import org.springframework.jdbc.datasource.DataSourceUtils
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import qanda.backend.authorization.api.AuthorizationActor
import qanda.backend.authorization.api.AuthorizationAccountGuards
import qanda.backend.authorization.api.AuthorizationIdentityPort
import qanda.backend.authorization.api.GuardMode
import qanda.backend.authorization.api.OwnedShareReadProof
import qanda.backend.authorization.api.Recipient
import qanda.backend.identity.api.*
import qanda.backend.platform.http.RequestIds
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock
import java.util.UUID
import javax.sql.DataSource

@Component
class AuthorizationIdentityAdapter(
    private val guards: IdentityGuards, private val service: IdentityService, private val clock: Clock,
    private val tx: JdbcTransactions, private val dataSource: DataSource,
) : AuthorizationIdentityPort {
    private fun auth() = SecurityContextHolder.getContext().authentication?.principal as? AuthContext ?: unauthenticated()
    override fun currentActor(): AuthorizationActor = auth().let { AuthorizationActor(it.accountId,it.sessionId) }
    override fun lockAccountsAndSessionInTransaction(actor: AuthorizationActor, modes: Map<UUID,GuardMode>): AuthorizationAccountGuards = tx.mandatory {
        val auth = auth()
        check(actor == AuthorizationActor(auth.accountId,auth.sessionId) && auth.accountId in modes) { "Actor must match the authenticated request" }
        val accounts = guards.lockAccountsInTransaction(modes.map { (id,mode) -> AccountLock(id,if (mode == GuardMode.UPDATE) LockMode.UPDATE else LockMode.SHARE) })
        val sessions = guards.lockSessionsInTransaction(listOf(SessionLock(auth.sessionId)))
        AuthorizationIdentityGuards(guards.requireActiveForWrite(auth,accounts,sessions,clock.instant()),accounts,guards)
    }
    override fun resolveRecipient(accountCode: String): Recipient {
        val request = (RequestContextHolder.currentRequestAttributes() as ServletRequestAttributes).request
        return service.resolveRecipient(auth(),accountCode,request.remoteAddr,RequestIds.get(request)).let { Recipient(it.accountId,it.accountCode,it.nickname) }
    }
    override fun readRecipientSummariesForOwnedShares(accountIds: List<UUID>, proof: OwnedShareReadProof): List<Recipient> = tx.mandatory {
        val auth = auth()
        check(proof.ownerAccountId == auth.accountId && proof.transactionConnection === DataSourceUtils.getConnection(dataSource) && accountIds.all { it in proof.recipientAccountIds }) { "Share proof is not bound to this owner, transaction or page" }
        guards.assertAccountGuard(guards.existingAccountGuardInTransaction(auth.accountId))
        service.readVerifiedOwnerLabelsInTransaction(accountIds).map { Recipient(it.accountId,it.accountCode,it.nickname) }
    }
}
