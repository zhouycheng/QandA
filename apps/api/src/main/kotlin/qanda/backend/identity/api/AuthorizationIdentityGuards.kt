package qanda.backend.identity.api

import qanda.backend.authorization.api.AuthorizationAccountGuards
import qanda.backend.authorization.api.GuardMode
import qanda.backend.identity.IdentityGuards
import java.util.UUID

/** Q12 can consume the same already-held identity guards through this bridge. */
class AuthorizationIdentityGuards internal constructor(
    val actor: GuardedActor, val accountGuards: AccountGuards, private val identity: IdentityGuards,
) : AuthorizationAccountGuards {
    override fun assertHeld(accountId: UUID, mode: GuardMode) = identity.assertAccountGuard(accountGuards[accountId],if (mode == GuardMode.UPDATE) LockMode.UPDATE else LockMode.SHARE)
    override fun isActive(accountId: UUID): Boolean {
        assertHeld(accountId)
        return accountGuards[accountId].status == AccountStatus.ACTIVE
    }
}
