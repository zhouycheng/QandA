package qanda.backend.identity

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.identity.api.*
import qanda.backend.platform.transaction.JdbcTransactions
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

internal typealias Row = Map<String, Any?>
internal fun JdbcTemplate.rows(sql: String, vararg args: Any?): List<Row> = queryForList(sql,*args)
internal fun JdbcTemplate.row(sql: String, vararg args: Any?): Row? = rows(sql,*args).singleOrNull()
internal fun Row.uuid(key: String): UUID = this[key] as UUID
internal fun Row.text(key: String): String = this[key] as String
internal fun Row.number(key: String): Long = (this[key] as Number).toLong()
internal fun Row.time(key: String): Instant = (this[key] as Timestamp).toInstant()
internal fun Row.optionalTime(key: String): Instant? = (this[key] as Timestamp?)?.toInstant()
internal fun Row.bytes(key: String): ByteArray = this[key] as ByteArray
internal fun Instant.sql(): Timestamp = Timestamp.from(this)

@Component
class IdentityGuards(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val crypto: IdentityCrypto) {
    private val resource = Any()
    private class State {
        val id: UUID = UUID.randomUUID()
        var phase = 0
        val accounts = linkedMapOf<UUID,AccountGuard>()
        val sessions = linkedMapOf<UUID,SessionGuard>()
    }
    private fun state(): State {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "A current transaction is required" }
        val current = TransactionSynchronizationManager.getResource(resource) as State?
        if (current != null) return current
        return State().also { created ->
            TransactionSynchronizationManager.bindResource(resource,created)
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCompletion(status: Int) { TransactionSynchronizationManager.unbindResourceIfPossible(resource) }
            })
        }
    }
    fun currentTransactionId(): UUID = state().id
    fun assertCurrentTransaction(transactionId: UUID) { check(state().id == transactionId) { "Capability belongs to another transaction" } }
    fun advanceLockPhaseInTransaction(phase: Int) {
        val state = state()
        check(phase >= state.phase) { "Reverse lock order" }
        state.phase = phase
    }
    fun authenticate(bearer: String, now: Instant): AuthContext {
        if (!bearer.matches(Regex("[A-Za-z0-9_-]{43}"))) unauthenticated()
        val row = jdbc.row("""SELECT s.id,s.account_id,s.credential_version FROM identity_auth_session s
            JOIN identity_account a ON a.id=s.account_id WHERE s.token_digest=? AND s.revoked_at IS NULL
            AND s.expires_at>? AND a.status='ACTIVE' AND s.credential_version=a.credential_version""",crypto.tokenDigest(bearer),now.sql()) ?: unauthenticated()
        jdbc.update("UPDATE identity_auth_session SET last_seen_at=GREATEST(last_seen_at,?) WHERE id=? AND revoked_at IS NULL",now.sql(),row.uuid("id"))
        return AuthContext(row.uuid("account_id"),row.uuid("id"),row.number("credential_version"))
    }
    fun lockAccountsInTransaction(requests: List<AccountLock>): AccountGuards = tx.mandatory {
        val state = state()
        check(state.phase <= 10 && requests.map { it.accountId }.distinct().size == requests.size) { "Accounts must be predeclared before later locks" }
        for (request in requests.sortedBy { it.accountId.toString() }) {
            val existing = state.accounts[request.accountId]
            if (existing != null) {
                check(existing.mode == request.mode || existing.mode == LockMode.UPDATE) { "Lock upgrades are forbidden" }
                continue
            }
            check(state.accounts.isEmpty() || request.accountId.toString() > state.accounts.keys.last().toString()) { "Accounts must be locked in UUID order" }
            val mode = if (request.mode == LockMode.UPDATE) "UPDATE" else "SHARE"
            val row = jdbc.row("SELECT id,status,version,credential_version FROM identity_account WHERE id=? FOR $mode",request.accountId)
                ?: throw qanda.backend.platform.http.ApiException(org.springframework.http.HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","账号不存在")
            state.accounts[request.accountId] = AccountGuard(state.id,request.accountId,request.mode,AccountStatus.valueOf(row.text("status")),row.number("version"),row.number("credential_version"))
        }
        state.phase = 10
        AccountGuards(state.id,state.accounts.toMap())
    }
    internal fun newAccountGuard(id: UUID): AccountGuard {
        val state = state()
        check(state.accounts.isEmpty() && state.sessions.isEmpty() && state.phase == 0) { "New identity requires a fresh registration transaction" }
        return AccountGuard(state.id,id,LockMode.UPDATE,AccountStatus.ACTIVE,1,1).also { state.accounts[id] = it; state.phase = 10 }
    }
    fun lockSessionsInTransaction(requests: List<SessionLock>): SessionGuards = tx.mandatory {
        val state = state()
        check(state.phase <= 12 && state.accounts.isNotEmpty() && requests.map { it.sessionId }.distinct().size == requests.size) { "Sessions must follow accounts and precede domain locks" }
        for (request in requests.sortedBy { it.sessionId.toString() }) {
            val existing = state.sessions[request.sessionId]
            if (existing != null) {
                check(existing.mode == request.mode || existing.mode == LockMode.UPDATE) { "Lock upgrades are forbidden" }
                continue
            }
            check(state.sessions.isEmpty() || request.sessionId.toString() > state.sessions.keys.last().toString()) { "Sessions must be locked in UUID order" }
            val mode = if (request.mode == LockMode.UPDATE) "UPDATE" else "SHARE"
            val row = jdbc.row("SELECT * FROM identity_auth_session WHERE id=? FOR $mode",request.sessionId) ?: unauthenticated()
            check(state.accounts.containsKey(row.uuid("account_id"))) { "Session owner must be prelocked" }
            state.sessions[request.sessionId] = SessionGuard(state.id,request.sessionId,request.mode,row.uuid("account_id"),row.number("credential_version"),row.time("expires_at"),row.optionalTime("revoked_at"))
        }
        state.phase = 12
        SessionGuards(state.id,state.sessions.toMap())
    }
    fun requireActiveForWrite(auth: AuthContext, accounts: AccountGuards, sessions: SessionGuards, now: Instant): GuardedActor {
        val account = accounts[auth.accountId]
        val session = sessions[auth.sessionId]
        val state = state()
        check(accounts.transactionId == state.id && sessions.transactionId == state.id && state.accounts[auth.accountId] === account && state.sessions[auth.sessionId] === session) { "Stale or forged guards" }
        if (account.status != AccountStatus.ACTIVE || session.accountId != auth.accountId || session.revokedAt != null || !session.expiresAt.isAfter(now) || account.credentialVersion != auth.credentialVersion || session.credentialVersion != auth.credentialVersion) unauthenticated()
        return GuardedActor(auth,account,session)
    }
    fun assertAccountGuard(guard: AccountGuard, mode: LockMode = LockMode.SHARE) {
        val state = state()
        check(guard.transactionId == state.id && state.accounts[guard.accountId] === guard && (mode == LockMode.SHARE || guard.mode == LockMode.UPDATE)) { "Missing current account guard" }
    }
    fun existingAccountGuardInTransaction(accountId: UUID): AccountGuard = state().accounts[accountId] ?: error("Account was not prelocked")
    internal fun actor(auth: AuthContext, now: Instant, update: Boolean = false, sessionUpdate: Boolean = false, otherSessions: List<UUID> = emptyList()): GuardedActor {
        val accounts = lockAccountsInTransaction(listOf(AccountLock(auth.accountId,if (update) LockMode.UPDATE else LockMode.SHARE)))
        val sessions = lockSessionsInTransaction((otherSessions + auth.sessionId).distinct().map { SessionLock(it,if (sessionUpdate || it != auth.sessionId) LockMode.UPDATE else LockMode.SHARE) })
        return requireActiveForWrite(auth,accounts,sessions,now)
    }
}
