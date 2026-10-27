package qanda.backend.identity

import org.springframework.beans.factory.ObjectProvider
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@Service
class IdentityService(
    private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val crypto: IdentityCrypto,
    val guards: IdentityGuards, private val evidence: IdentityEvidence, private val clock: Clock,
    private val membershipProvider: ObjectProvider<IdentityMembershipPort>,
    private val administrationProvider: ObjectProvider<IdentityAdministrationPort>,
    private val shareProvider: ObjectProvider<IdentityShareProjectionPort>,
    private val wechat: WechatCodeExchange,
) {
    private fun <T: Any> root(block: () -> T): T {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Use the in-transaction ports inside an existing business root" }
        try { return tx.required { jdbc.execute("SET LOCAL lock_timeout='3s'"); block() } }
        catch (_: org.springframework.dao.PessimisticLockingFailureException) {
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"TEMPORARILY_UNAVAILABLE","请稍后重试",details=ErrorDetails(retryAfterSeconds=1))
        }
    }
    private fun now() = clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private fun administration() = administrationProvider.ifAvailable ?: unavailable("ADMIN_SECURITY_UNAVAILABLE")
    private fun account(id: UUID) = jdbc.row("SELECT * FROM identity_account WHERE id=?",id) ?: unauthenticated()
    private fun emailRow(id: UUID) = jdbc.row("SELECT * FROM identity_email WHERE account_id=?",id)
    private fun registration(row: Row, resultVersion: Long = row.number("version")) = RegistrationResult(row.uuid("id"),row.text("account_code"),resultVersion)
    private fun checkVersion(guard: AccountGuard, expected: Long) {
        version(expected)
        if (guard.version != expected) throw ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","资料已更新，请刷新后重试",details=ErrorDetails(currentVersion=guard.version))
    }
    private fun insertAccount(displayName: String, now: Instant): AccountGuard {
        repeat(5) {
            val id = UUID.randomUUID()
            if (jdbc.update("""INSERT INTO identity_account(id,account_code,nickname,status,created_at,updated_at)
                VALUES (?,?,?,'ACTIVE',?,?) ON CONFLICT(account_code) DO NOTHING""",id,crypto.accountCode(),displayName,now.sql(),now.sql()) == 1) return guards.newAccountGuard(id)
        }
        unavailable("ACCOUNT_CODE_UNAVAILABLE")
    }
    private fun insertEmail(id: UUID, address: Email, now: Instant) {
        if (jdbc.update("""INSERT INTO identity_email(account_id,email,email_key,verified_at,updated_at)
            VALUES (?,?,?,?,?) ON CONFLICT(email_key) DO NOTHING""",id,address.display,address.key,now.sql(),now.sql()) != 1) conflict("ACCOUNT_LINK_REQUIRED","该邮箱已关联账号，请切换到该账号")
    }
    private fun insertWechat(id: UUID, identity: WechatIdentity, now: Instant) {
        if (jdbc.update("""INSERT INTO identity_wechat(id,account_id,app_id,open_id,union_id,bound_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT DO NOTHING""",UUID.randomUUID(),id,identity.appId,identity.openId,identity.unionId,now.sql()) != 1) conflict("ACCOUNT_LINK_REQUIRED","该微信身份已关联账号或当前账号已绑定微信")
    }
    private fun putPassword(id: UUID, prepared: PreparedPassword, now: Instant) {
        jdbc.update("""INSERT INTO identity_password(account_id,encoded_password,changed_at) VALUES (?,?,?)
            ON CONFLICT(account_id) DO UPDATE SET encoded_password=EXCLUDED.encoded_password,changed_at=EXCLUDED.changed_at""",id,prepared.encoded,now.sql())
    }
    private fun bump(guard: AccountGuard, now: Instant, credentials: Boolean): Row {
        guards.assertAccountGuard(guard,LockMode.UPDATE)
        if (guard.version == MAX_VERSION || (credentials && guard.credentialVersion == MAX_VERSION)) conflict("VERSION_EXHAUSTED","账号版本已达上限")
        val changed = jdbc.update("""UPDATE identity_account SET version=version+1,credential_version=credential_version+?,updated_at=?
            WHERE id=? AND version=?""",if (credentials) 1 else 0,now.sql(),guard.accountId,guard.version)
        check(changed == 1)
        return account(guard.accountId)
    }
    private fun versionChanges(before: AccountGuard, after: Row): List<StatusChange> = buildList {
        if (before.version != after.number("version")) add(StatusChange("RESOURCE_VERSION",before.version.toString(),after.number("version").toString()))
        if (before.credentialVersion != after.number("credential_version")) add(StatusChange("CREDENTIAL_VERSION",before.credentialVersion.toString(),after.number("credential_version").toString()))
    }
    private class RegistrationReplay(val receipt: Row) : RuntimeException()
    private fun replayPublic(row: Row, command: IdentityCommand, now: Instant): RegistrationResult = root {
        val guard = guards.lockAccountsInTransaction(listOf(AccountLock(row.uuid("account_id"),LockMode.UPDATE)))[row.uuid("account_id")]
        evidence.validateReceipt(row,command,guard,now)
        registration(account(guard.accountId),row.number("resulting_account_version"))
    }
    private fun register(
        kind: String, scope: UUID, displayName: String, collegeId: UUID, majorId: UUID,
        command: IdentityCommand, now: Instant, installCredentials: (AccountGuard) -> Unit,
    ): RegistrationResult {
        try {
            return root {
                val guard = insertAccount(displayName,now)
                val membership = membershipProvider.ifAvailable ?: unavailable("ORGANIZATION_UNAVAILABLE")
                guards.advanceLockPhaseInTransaction(20)
                val selection = membership.prepareMembershipSelectionInTransaction(collegeId,majorId,guard)
                check(selection.transactionId == guard.transactionId && selection.accountId == guard.accountId && selection.collegeId == collegeId && selection.majorId == majorId)
                installCredentials(guard)
                val initialized = membership.initializeMembershipInTransaction(guard.accountId,collegeId,majorId,selection,now)
                check(initialized.version == 1L && initialized.audit.version == initialized.version && initialized.audit.accountId == guard.accountId && initialized.audit.collegeId == collegeId && initialized.audit.majorId == majorId)
                val result = account(guard.accountId)
                evidence.saveReceipt(kind,scope,command,result,201,now)
                evidence.audit(listOf(IdentityEvent(action="ACCOUNT_REGISTERED",actorAccountId=guard.accountId,targetType="ACCOUNT",targetId=guard.accountId)),command.requestId,now,initialized.audit)
                registration(result)
            }
        } catch (replay: RegistrationReplay) { return replayPublic(replay.receipt,command,now) }
    }
    fun registerEmail(challengeId: UUID, submittedCode: String, password: String, displayName: String, collegeId: UUID, majorId: UUID, command: IdentityCommand): RegistrationResult {
        val now = now(); val name = nickname(displayName); code(submittedCode)
        evidence.receipt("EMAIL_CHALLENGE",challengeId,command)?.let { return replayPublic(it,command,now) }
        try { evidence.preflightProof(challengeId,"REGISTER",submittedCode,null,now,command.requestId) }
        catch (error: ApiException) {
            if (error.code == "VERIFICATION_FAILED") evidence.receipt("EMAIL_CHALLENGE",challengeId,command)?.let { return replayPublic(it,command,now) }
            throw error
        }
        val prepared = crypto.preparePassword(password)
        return register("EMAIL_CHALLENGE",challengeId,name,collegeId,majorId,command,now) { guard ->
            jdbc.row("SELECT id FROM identity_email_challenge WHERE id=? FOR UPDATE",challengeId) ?: invalidProof()
            evidence.receipt("EMAIL_CHALLENGE",challengeId,command)?.let { throw RegistrationReplay(it) }
            val proof = evidence.lockedProof(challengeId,"REGISTER",submittedCode,null,now)
            insertEmail(guard.accountId,Email(proof.text("recipient"),proof.text("email_key")),now)
            putPassword(guard.accountId,prepared,now)
            evidence.consume(challengeId,now)
        }
    }
    fun registerWechat(registrationToken: String, displayName: String, collegeId: UUID, majorId: UUID, command: IdentityCommand): RegistrationResult {
        val now = now(); token(registrationToken); val name = nickname(displayName)
        val ticket = jdbc.row("SELECT * FROM identity_wechat_ticket WHERE ticket_digest=?",crypto.tokenDigest(registrationToken)) ?: invalidProof()
        val id = ticket.uuid("id")
        evidence.receipt("WECHAT_TICKET",id,command)?.let { return replayPublic(it,command,now) }
        return register("WECHAT_TICKET",id,name,collegeId,majorId,command,now) { guard ->
            val locked = jdbc.row("SELECT * FROM identity_wechat_ticket WHERE id=? FOR UPDATE",id) ?: invalidProof()
            evidence.receipt("WECHAT_TICKET",id,command)?.let { throw RegistrationReplay(it) }
            if (locked["consumed_at"] != null || !locked.time("expires_at").isAfter(now)) invalidProof()
            insertWechat(guard.accountId,WechatIdentity(locked.text("app_id"),locked.text("open_id"),locked["union_id"] as String?),now)
            jdbc.update("UPDATE identity_wechat_ticket SET consumed_at=?,account_id=? WHERE id=?",now.sql(),guard.accountId,id)
        }
    }
    fun prepareLocalBootstrapPassword(rawPassword: String): PreparedPassword = crypto.preparePassword(rawPassword)
    fun preflightBootstrapProof(challengeId: UUID, submittedCode: String, requestId: UUID) = evidence.preflightProof(challengeId,"REGISTER",submittedCode,null,now(),requestId)
    fun createBootstrapIdentityInTransaction(challengeId: UUID, submittedCode: String, preparedPassword: PreparedPassword, displayName: String?, now: Instant): RegistrationResult = tx.mandatory {
        code(submittedCode)
        val guard = insertAccount(nickname(displayName ?: "Q友"),now)
        val proof = evidence.lockedProof(challengeId,"REGISTER",submittedCode,null,now)
        insertEmail(guard.accountId,Email(proof.text("recipient"),proof.text("email_key")),now)
        putPassword(guard.accountId,preparedPassword,now)
        evidence.consume(challengeId,now)
        registration(account(guard.accountId))
    }
    fun requestPublicEmailChallenge(purpose: String, rawEmail: String, source: String, requestId: UUID): EmailChallenge {
        if (purpose !in setOf("REGISTER","RESET_PASSWORD")) invalid("purpose")
        val now = now(); val address = email(rawEmail)
        evidence.reserveRates(evidence.mailRates(purpose,address.key,source),null,now,requestId)
        val material = evidence.prepare(purpose,address,now)
        val existing = jdbc.row("SELECT account_id FROM identity_email WHERE email_key=?",address.key)
        return root {
            val guard = if (purpose == "RESET_PASSWORD" && existing != null) guards.lockAccountsInTransaction(listOf(AccountLock(existing.uuid("account_id"))))[existing.uuid("account_id")] else null
            val current = jdbc.row("SELECT account_id FROM identity_email WHERE email_key=?",address.key)
            val eligible = if (purpose == "REGISTER") current == null else guard != null && guard.status == AccountStatus.ACTIVE && current?.get("account_id") == guard.accountId
            evidence.insertChallenge(material,guard,eligible,now,requestId)
        }
    }
    private fun issueSession(guard: AccountGuard, type: ClientType, deviceId: UUID, rememberMe: Boolean, now: Instant, requestId: UUID): TokenGrant {
        guards.assertAccountGuard(guard)
        if (guard.status != AccountStatus.ACTIVE) unauthenticated()
        val raw = crypto.randomToken(); val id = UUID.randomUUID(); val expires = now.plusSeconds(if (rememberMe) 2592000 else 86400)
        jdbc.update("""INSERT INTO identity_auth_session(id,account_id,token_digest,credential_version,client_type,device_id,issued_at,expires_at,last_seen_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",id,guard.accountId,crypto.tokenDigest(raw),guard.credentialVersion,type.name,deviceId,now.sql(),expires.sql(),now.sql())
        evidence.audit(listOf(IdentityEvent(action="LOGIN_SUCCEEDED",actorAccountId=guard.accountId,targetType="AUTH_SESSION",targetId=id)),requestId,now)
        return TokenGrant(raw,id,guard.accountId,expires)
    }
    fun createEmailSession(rawEmail: String, password: String, type: ClientType, deviceId: UUID, rememberMe: Boolean, source: String, requestId: UUID): TokenGrant {
        val now = now(); val address = email(rawEmail)
        evidence.checkLoginRate(address.key,source,now,requestId)
        val credential = jdbc.row("SELECT e.account_id,p.encoded_password FROM identity_email e LEFT JOIN identity_password p ON p.account_id=e.account_id WHERE e.email_key=?",address.key)
        val encoded = credential?.get("encoded_password") as String?
        if (!crypto.verifyPassword(password,encoded)) {
            evidence.reserveRates(evidence.loginRates(address.key,source),null,now,requestId)
            unauthenticated()
        }
        return root {
            val id = credential!!.uuid("account_id")
            val guard = guards.lockAccountsInTransaction(listOf(AccountLock(id)))[id]
            val current = jdbc.row("SELECT p.encoded_password FROM identity_password p JOIN identity_email e ON e.account_id=p.account_id WHERE p.account_id=? AND e.email_key=?",id,address.key)
            if (current?.get("encoded_password") != encoded) unauthenticated()
            issueSession(guard,type,deviceId,rememberMe,now,requestId)
        }
    }
    fun createWechatSession(submittedCode: String, type: ClientType, deviceId: UUID, source: String, requestId: UUID): WechatAuthResult {
        wechatCode(submittedCode); if (type != ClientType.MINI_PROGRAM) invalid("clientType")
        val now = now(); evidence.checkLoginRate("wechat:$source",source,now,requestId)
        val identity = try { wechat.exchange(submittedCode) } catch (error: ApiException) {
            if (error.status == HttpStatus.UNAUTHORIZED) evidence.reserveRates(evidence.loginRates("wechat:$source",source),null,now,requestId)
            throw error
        }
        val mapping = jdbc.row("SELECT account_id FROM identity_wechat WHERE app_id=? AND open_id=?",identity.appId,identity.openId)
        return root {
            if (mapping == null) {
                val raw = crypto.randomToken(); val expires = now.plusSeconds(600)
                jdbc.update("INSERT INTO identity_wechat_ticket(id,ticket_digest,app_id,open_id,union_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
                    UUID.randomUUID(),crypto.tokenDigest(raw),identity.appId,identity.openId,identity.unionId,now.sql(),expires.sql())
                RegistrationRequired(raw,expires)
            } else {
                val id = mapping.uuid("account_id"); val guard = guards.lockAccountsInTransaction(listOf(AccountLock(id)))[id]
                if (jdbc.row("SELECT account_id FROM identity_wechat WHERE app_id=? AND open_id=?",identity.appId,identity.openId)?.get("account_id") != id) unauthenticated()
                issueSession(guard,type,deviceId,false,now,requestId)
            }
        }
    }
    fun getMe(auth: AuthContext): Me = root {
        val actor = guards.actor(auth,now())
        guards.advanceLockPhaseInTransaction(14)
        val admin = administration().hasAdminQualificationInTransaction(actor)
        val row = account(auth.accountId); val email = emailRow(auth.accountId)
        Me(AccountProfile(auth.accountId,row.text("account_code"),row.text("nickname"),AccountStatus.valueOf(row.text("status")),row.number("version"),row.time("created_at"),row.time("updated_at"),
            email?.text("email"),email?.time("verified_at"),jdbc.row("SELECT account_id FROM identity_password WHERE account_id=?",auth.accountId) != null,
            jdbc.row("SELECT account_id FROM identity_wechat WHERE account_id=? LIMIT 1",auth.accountId) != null),admin)
    }
    private fun ownReplay(auth: AuthContext, command: IdentityCommand, now: Instant): Row? = root {
        val actor = guards.actor(auth,now,update=true)
        listOfNotNull(evidence.receipt("ACCOUNT",auth.accountId,command)?.also { evidence.validateReceipt(it,command,actor.account,now) })
    }.firstOrNull()
    private fun ownMutation(auth: AuthContext, expected: Long, command: IdentityCommand, now: Instant, status: Int = 204, action: String?, block: (AccountGuard) -> UUID?): Row = root {
        val actor = guards.actor(auth,now,update=true)
        val previous = evidence.receipt("ACCOUNT",auth.accountId,command)
        if (previous != null) { evidence.validateReceipt(previous,command,actor.account,now); previous }
        else {
            checkVersion(actor.account,expected)
            val changeId = block(actor.account)
            val after = account(auth.accountId)
            evidence.saveReceipt("ACCOUNT",auth.accountId,command,after,status,now,changeId)
            if (action != null) evidence.audit(listOf(IdentityEvent(action=action,actorAccountId=auth.accountId,targetType="ACCOUNT",targetId=auth.accountId,changes=versionChanges(actor.account,after))),command.requestId,now)
            evidence.receipt("ACCOUNT",auth.accountId,command)!!
        }
    }
    fun updateProfile(auth: AuthContext, expected: Long, displayName: String, command: IdentityCommand): ProfileEditResult {
        val name = nickname(displayName); val now = now()
        val receipt = ownMutation(auth,expected,command,now,200,null) { guard ->
            bump(guard,now,false)
            jdbc.update("UPDATE identity_account SET nickname=? WHERE id=?",name,auth.accountId)
            null
        }
        return ProfileEditResult(auth.accountId,receipt.number("resulting_account_version"))
    }
    fun requestOwnEmailChallenge(auth: AuthContext, purpose: String, rawEmail: String?, source: String, requestId: UUID): EmailChallenge {
        if (purpose !in setOf("BIND_EMAIL","CHANGE_PASSWORD") || (purpose == "BIND_EMAIL") != (rawEmail != null)) invalid("purpose")
        val now = now()
        val initial = emailRow(auth.accountId)
        val address = if (purpose == "BIND_EMAIL") email(rawEmail!!) else initial?.let { Email(it.text("email"),it.text("email_key")) } ?: conflict("EMAIL_REQUIRED","请先绑定邮箱")
        evidence.reserveRates(evidence.mailRates(purpose,address.key,source),auth,now,requestId)
        val material = evidence.prepare(purpose,address,now)
        return root {
            val actor = guards.actor(auth,now,update=true)
            val current = emailRow(auth.accountId)
            if (purpose == "BIND_EMAIL") {
                if (current != null) conflict("EMAIL_ALREADY_BOUND","当前账号已有邮箱，请使用更换邮箱流程")
                if (jdbc.row("SELECT account_id FROM identity_email WHERE email_key=?",address.key) != null) conflict("ACCOUNT_LINK_REQUIRED","该邮箱已关联账号，请切换到该账号")
            } else if (current?.get("email_key") != address.key) conflict("CREDENTIAL_CONTEXT_CHANGED","邮箱已变化，请重新验证")
            jdbc.update("UPDATE identity_email_challenge SET invalidated_at=? WHERE account_id=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL",now.sql(),auth.accountId,purpose)
            evidence.insertChallenge(material,actor.account,true,now,requestId)
        }
    }
    fun bindEmail(auth: AuthContext, challengeId: UUID, submittedCode: String, expected: Long, command: IdentityCommand) {
        val now = now(); code(submittedCode)
        if (ownReplay(auth,command,now) != null) return
        evidence.preflightProof(challengeId,"BIND_EMAIL",submittedCode,auth.accountId,now,command.requestId)
        ownMutation(auth,expected,command,now,action="IDENTITY_BOUND") { guard ->
            if (emailRow(auth.accountId) != null) conflict("EMAIL_ALREADY_BOUND","当前账号已有邮箱")
            val proof = evidence.lockedProof(challengeId,"BIND_EMAIL",submittedCode,guard,now)
            insertEmail(auth.accountId,Email(proof.text("recipient"),proof.text("email_key")),now)
            evidence.consume(challengeId,now); bump(guard,now,true); null
        }
    }
    fun changePassword(auth: AuthContext, challengeId: UUID, submittedCode: String, rawPassword: String, expected: Long, command: IdentityCommand) {
        val now = now(); code(submittedCode)
        if (ownReplay(auth,command,now) != null) return
        evidence.preflightProof(challengeId,"CHANGE_PASSWORD",submittedCode,auth.accountId,now,command.requestId)
        val prepared = crypto.preparePassword(rawPassword)
        ownMutation(auth,expected,command,now,action="CREDENTIAL_CHANGED") { guard ->
            val proof = evidence.lockedProof(challengeId,"CHANGE_PASSWORD",submittedCode,guard,now)
            if (emailRow(auth.accountId)?.get("email_key") != proof.text("email_key")) invalidProof()
            putPassword(auth.accountId,prepared,now); evidence.consume(challengeId,now); bump(guard,now,true); null
        }
    }
    fun resetPassword(challengeId: UUID, submittedCode: String, rawPassword: String, command: IdentityCommand) {
        val now = now(); code(submittedCode)
        evidence.receipt("EMAIL_CHALLENGE",challengeId,command)?.let { replayPublic(it,command,now); return }
        val initial = jdbc.row("SELECT account_id FROM identity_email_challenge WHERE id=? AND purpose='RESET_PASSWORD'",challengeId) ?: invalidProof()
        val accountId = initial["account_id"] as UUID?
        try { evidence.preflightProof(challengeId,"RESET_PASSWORD",submittedCode,accountId,now,command.requestId) }
        catch (error: ApiException) {
            if (error.code == "VERIFICATION_FAILED") evidence.receipt("EMAIL_CHALLENGE",challengeId,command)?.let { replayPublic(it,command,now); return }
            throw error
        }
        if (accountId == null) invalidProof()
        val prepared = crypto.preparePassword(rawPassword)
        root {
            val guard = guards.lockAccountsInTransaction(listOf(AccountLock(accountId,LockMode.UPDATE)))[accountId]
            val receipt = evidence.receipt("EMAIL_CHALLENGE",challengeId,command)
            if (receipt != null) evidence.validateReceipt(receipt,command,guard,now)
            else {
                val proof = evidence.lockedProof(challengeId,"RESET_PASSWORD",submittedCode,guard,now)
                if (emailRow(accountId)?.get("email_key") != proof.text("email_key")) invalidProof()
                putPassword(accountId,prepared,now); evidence.consume(challengeId,now)
                val after = bump(guard,now,true)
                evidence.saveReceipt("EMAIL_CHALLENGE",challengeId,command,after,204,now)
                evidence.audit(listOf(IdentityEvent(action="CREDENTIAL_CHANGED",actorAccountId=accountId,targetType="ACCOUNT",targetId=accountId,changes=versionChanges(guard,after))),command.requestId,now)
            }
        }
    }
    fun requestEmailChange(auth: AuthContext, rawEmail: String, expected: Long, source: String, command: IdentityCommand): EmailChange {
        val now = now(); version(expected); val address = email(rawEmail,"newEmail")
        ownReplay(auth,command,now)?.let { return emailChange(it.uuid("email_change_id")) }
        val original = emailRow(auth.accountId) ?: conflict("EMAIL_REQUIRED","请先绑定邮箱")
        val old = Email(original.text("email"),original.text("email_key"))
        if (old.key == address.key) conflict("EMAIL_UNCHANGED","新邮箱与原邮箱相同")
        val rates = evidence.mailRates("CHANGE_EMAIL_OLD",old.key,source) + evidence.mailRates("CHANGE_EMAIL_NEW",address.key,source).filter { it.kind != "SOURCE" }
        evidence.reserveRates(rates,auth,now,command.requestId)
        val oldMaterial = evidence.prepare("CHANGE_EMAIL_OLD",old,now); val newMaterial = evidence.prepare("CHANGE_EMAIL_NEW",address,now)
        val receipt = ownMutation(auth,expected,command,now,201,null) { guard ->
            if (emailRow(auth.accountId)?.get("email_key") != old.key) conflict("CREDENTIAL_CONTEXT_CHANGED","邮箱已变化，请重新验证")
            if (jdbc.row("SELECT account_id FROM identity_email WHERE email_key=?",address.key) != null) conflict("ACCOUNT_LINK_REQUIRED","该邮箱已关联账号，请切换到该账号")
            val id = UUID.randomUUID()
            jdbc.update("UPDATE identity_email_challenge SET invalidated_at=? WHERE account_id=? AND email_change_id IS NOT NULL AND consumed_at IS NULL AND invalidated_at IS NULL",now.sql(),auth.accountId)
            jdbc.update("UPDATE identity_email_change SET invalidated_at=? WHERE account_id=? AND confirmed_at IS NULL AND invalidated_at IS NULL",now.sql(),auth.accountId)
            jdbc.update("""INSERT INTO identity_email_change(id,account_id,old_email_key,new_email,new_email_key,expected_account_version,created_at,expires_at)
                VALUES (?,?,?,?,?,?,?,?)""",id,auth.accountId,old.key,address.display,address.key,expected,now.sql(),now.plusSeconds(600).sql())
            evidence.insertChallenge(oldMaterial,guard,true,now,command.requestId,id)
            evidence.insertChallenge(newMaterial,guard,true,now,command.requestId,id)
            id
        }
        return emailChange(receipt.uuid("email_change_id"))
    }
    private fun emailChange(id: UUID): EmailChange {
        val parent = jdbc.row("SELECT * FROM identity_email_change WHERE id=?",id) ?: invalidProof()
        val challenges = jdbc.rows("SELECT id,purpose,next_send_at FROM identity_email_challenge WHERE email_change_id=?",id)
        val old = challenges.single { it.text("purpose") == "CHANGE_EMAIL_OLD" }; val new = challenges.single { it.text("purpose") == "CHANGE_EMAIL_NEW" }
        return EmailChange(id,old.uuid("id"),new.uuid("id"),maskEmail(parent.text("old_email_key")),maskEmail(parent.text("new_email")),parent.time("expires_at"),old.time("next_send_at"),parent.number("expected_account_version"))
    }
    fun confirmEmailChange(auth: AuthContext, changeId: UUID, oldCode: String, newCode: String, expected: Long, command: IdentityCommand) {
        val now = now(); code(oldCode); code(newCode)
        if (ownReplay(auth,command,now) != null) return
        val initial = jdbc.row("SELECT * FROM identity_email_change WHERE id=? AND account_id=?",changeId,auth.accountId) ?: invalidProof()
        val children = jdbc.rows("SELECT id,purpose FROM identity_email_challenge WHERE email_change_id=? ORDER BY id",changeId)
        for (child in children) evidence.preflightProof(child.uuid("id"),child.text("purpose"),if (child.text("purpose") == "CHANGE_EMAIL_OLD") oldCode else newCode,auth.accountId,now,command.requestId)
        if (children.size != 2 || initial.number("expected_account_version") != expected) invalidProof()
        ownMutation(auth,expected,command,now,action="CREDENTIAL_CHANGED") { guard ->
            val parent = jdbc.row("SELECT * FROM identity_email_change WHERE id=? FOR UPDATE",changeId) ?: invalidProof()
            if (parent["account_id"] != auth.accountId || parent["confirmed_at"] != null || parent["invalidated_at"] != null || !parent.time("expires_at").isAfter(now) || parent.number("expected_account_version") != guard.version || emailRow(auth.accountId)?.get("email_key") != parent.text("old_email_key")) invalidProof()
            for (child in children) {
                val proof = evidence.lockedProof(child.uuid("id"),child.text("purpose"),if (child.text("purpose") == "CHANGE_EMAIL_OLD") oldCode else newCode,guard,now)
                if (proof["email_change_id"] != changeId) invalidProof()
            }
            if (jdbc.row("SELECT account_id FROM identity_email WHERE email_key=?",parent.text("new_email_key")) != null) conflict("ACCOUNT_LINK_REQUIRED","该邮箱已关联账号，请切换到该账号")
            // The unique key also serializes races with another account binding this address.
            try { jdbc.update("UPDATE identity_email SET email=?,email_key=?,verified_at=?,updated_at=? WHERE account_id=?",parent.text("new_email"),parent.text("new_email_key"),now.sql(),now.sql(),auth.accountId) }
            catch (_: org.springframework.dao.DuplicateKeyException) { conflict("ACCOUNT_LINK_REQUIRED","该邮箱已关联账号，请切换到该账号") }
            children.forEach { evidence.consume(it.uuid("id"),now) }
            jdbc.update("UPDATE identity_email_change SET confirmed_at=? WHERE id=?",now.sql(),changeId)
            bump(guard,now,true); null
        }
    }
    fun bindWechat(auth: AuthContext, submittedCode: String, expected: Long, command: IdentityCommand) {
        wechatCode(submittedCode); version(expected); val now = now()
        if (ownReplay(auth,command,now) != null) return
        val identity = wechat.exchange(submittedCode)
        ownMutation(auth,expected,command,now,action="IDENTITY_BOUND") { guard ->
            insertWechat(auth.accountId,identity,now); bump(guard,now,true); null
        }
    }
    fun listSessions(auth: AuthContext, page: Int, pageSize: Int): Page<SessionInfo> {
        page(page,pageSize); val now = now()
        return root {
            guards.actor(auth,now)
            val rows = jdbc.rows("""WITH active AS (SELECT * FROM identity_auth_session WHERE account_id=? AND credential_version=? AND revoked_at IS NULL AND expires_at>?),
                paged AS (SELECT * FROM active ORDER BY issued_at DESC,id LIMIT ? OFFSET ?)
                SELECT t.total,p.* FROM (SELECT count(*) total FROM active) t LEFT JOIN paged p ON TRUE ORDER BY p.issued_at DESC,p.id""",
                auth.accountId,auth.credentialVersion,now.sql(),pageSize,(page.toLong()-1)*pageSize)
            Page(rows.filter { it["id"] != null }.map { SessionInfo(it.uuid("id"),ClientType.valueOf(it.text("client_type")),it.uuid("device_id"),it.time("issued_at"),it.time("expires_at"),it.time("last_seen_at"),it.uuid("id") == auth.sessionId) },page,pageSize,rows.first().number("total"))
        }
    }
    fun revokeSession(auth: AuthContext, sessionId: UUID, requestId: UUID) {
        val now = now()
        if (jdbc.row("SELECT id FROM identity_auth_session WHERE id=? AND account_id=?",sessionId,auth.accountId) == null) throw ApiException(HttpStatus.NOT_FOUND,"SESSION_NOT_FOUND","会话不存在")
        root {
            guards.actor(auth,now,sessionUpdate=true,otherSessions=listOf(sessionId))
            if (jdbc.update("UPDATE identity_auth_session SET revoked_at=?,revocation_reason='USER_REVOKED' WHERE id=? AND account_id=? AND revoked_at IS NULL",now.sql(),sessionId,auth.accountId) == 1)
                evidence.audit(listOf(IdentityEvent(action="SESSION_REVOKED",actorAccountId=auth.accountId,targetType="AUTH_SESSION",targetId=sessionId)),requestId,now)
        }
    }
    fun logout(auth: AuthContext?, requestId: UUID) {
        if (auth == null) return
        try { revokeSession(auth,auth.sessionId,requestId) } catch (error: ApiException) { if (error.status != HttpStatus.UNAUTHORIZED) throw error }
    }
    fun resolveRecipient(auth: AuthContext, accountCode: String, source: String, requestId: UUID): Recipient {
        if (!accountCode.matches(Regex("QA[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}"))) invalid("accountCode")
        val now = now()
        evidence.reserveRates(listOf(Rate("RECIPIENT_LOOKUP","ACCOUNT",auth.accountId.toString(),60,30),Rate("RECIPIENT_LOOKUP","SOURCE",source,3600,100)),auth,now,requestId)
        return root {
            guards.actor(auth,now)
            val row = jdbc.row("SELECT id,account_code,nickname FROM identity_account WHERE account_code=? AND status='ACTIVE'",accountCode)
                ?: throw ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","账号不存在")
            Recipient(row.uuid("id"),row.text("account_code"),row.text("nickname"))
        }
    }
    fun resolveRecipientInTransaction(accountId: UUID): Recipient = tx.mandatory {
        val guard = guards.existingAccountGuardInTransaction(accountId); guards.assertAccountGuard(guard)
        if (guard.status != AccountStatus.ACTIVE) throw ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","账号不存在")
        val row = account(accountId); Recipient(accountId,row.text("account_code"),row.text("nickname"))
    }
    fun getVerifiedEmail(accountId: UUID, purpose: VerifiedEmailPurpose): VerifiedEmailState = tx.mandatory {
        check(purpose == VerifiedEmailPurpose.IDENTITY_CREDENTIAL_VERIFICATION)
        val guard = guards.existingAccountGuardInTransaction(accountId); guards.assertAccountGuard(guard)
        val row = emailRow(accountId)
        VerifiedEmailState(accountId,guard.status,row?.text("email"),row?.time("verified_at"))
    }
    fun checkIdentityMailEligibilityInTransaction(challengeId: UUID, now: Instant): IdentityMailEligibility = tx.mandatory {
        val row = jdbc.row("""SELECT c.*,a.status account_status,a.credential_version current_credential_version,a.version account_version,
            e.email_key current_email_key,p.old_email_key,p.expected_account_version,p.confirmed_at parent_confirmed,p.invalidated_at parent_invalidated,p.expires_at parent_expires,
            EXISTS(SELECT 1 FROM identity_email t WHERE t.email_key=c.email_key) target_claimed,
            EXISTS(SELECT 1 FROM identity_email t WHERE t.email_key=p.new_email_key) new_target_claimed
            FROM identity_email_challenge c LEFT JOIN identity_account a ON a.id=c.account_id
            LEFT JOIN identity_email e ON e.account_id=c.account_id LEFT JOIN identity_email_change p ON p.id=c.email_change_id WHERE c.id=?""",challengeId)
        val reason = when {
            row == null -> "NOT_FOUND"
            row["eligible"] != true -> "DECOY"
            row["consumed_at"] != null -> "CONSUMED"
            row["invalidated_at"] != null || row.number("failed_attempts") >= 5 -> "INVALIDATED"
            !row.time("expires_at").isAfter(now) -> "EXPIRED"
            row["account_id"] != null && row["account_status"] != "ACTIVE" -> "ACCOUNT_INACTIVE"
            row["account_id"] != null && row["credential_version"] != row["current_credential_version"] -> "CREDENTIAL_CHANGED"
            row.text("purpose") == "REGISTER" && row["target_claimed"] == true -> "TARGET_CHANGED"
            row.text("purpose") in setOf("RESET_PASSWORD","CHANGE_PASSWORD") && row["current_email_key"] != row["email_key"] -> "TARGET_CHANGED"
            row.text("purpose") == "BIND_EMAIL" && (row["current_email_key"] != null || row["target_claimed"] == true) -> "TARGET_CHANGED"
            row["email_change_id"] != null && (row["parent_confirmed"] != null || row["parent_invalidated"] != null || row.optionalTime("parent_expires")?.isAfter(now) != true || row["account_version"] != row["expected_account_version"] || row["current_email_key"] != row["old_email_key"] || row["new_target_claimed"] == true) -> "CHANGE_CLOSED"
            else -> "ELIGIBLE"
        }
        IdentityMailEligibility(reason == "ELIGIBLE",reason)
    }
    private fun validateIds(ids: List<UUID>) { require(ids.size in 1..100 && ids.distinct().size == ids.size) { "Expected 1..100 unique IDs" } }
    private fun labels(ids: List<UUID>): List<Recipient> {
        val indexed = jdbc.rows("SELECT id,account_code,nickname FROM identity_account WHERE id IN (${ids.joinToString(",") { "?" }})",*ids.toTypedArray()).associateBy { it.uuid("id") }
        check(indexed.size == ids.size) { "Referenced account missing" }
        return ids.map { indexed.getValue(it).let { row -> Recipient(it,row.text("account_code"),row.text("nickname")) } }
    }
    internal fun readVerifiedOwnerLabelsInTransaction(ids: List<UUID>): List<Recipient> = tx.mandatory { validateIds(ids); labels(ids) }
    fun readRecipientSummariesForOwnedShares(accountIds: List<UUID>, ownerPurpose: OwnedSharePurpose): List<Recipient> = tx.mandatory {
        validateIds(accountIds)
        (shareProvider.ifAvailable ?: unavailable("AUTHORIZATION_UNAVAILABLE")).validateOwnedShareProjectionInTransaction(ownerPurpose,accountIds,guards.currentTransactionId())
        labels(accountIds)
    }
    fun readAccountLabels(accountIds: List<UUID>, authorizedPurpose: AdministrationProof): List<Recipient> = tx.mandatory {
        validateIds(accountIds); administration().validateAdministrationInTransaction(authorizedPurpose,AccountProjectionPurpose.ADMIN_MINIMAL_LABELS); labels(accountIds)
    }
    private fun summary(row: Row) = AccountSummary(row.uuid("id"),row.text("account_code"),row.text("nickname"),AccountStatus.valueOf(row.text("status")),(row["email"] as String?)?.let(::maskEmail),row.time("created_at"),row.number("version"))
    fun readAccountSummaries(accountIds: List<UUID>, authorizedPurpose: AdministrationProof): List<AccountSummary> = tx.mandatory {
        validateIds(accountIds); administration().validateAdministrationInTransaction(authorizedPurpose,AccountProjectionPurpose.ADMIN_ACCOUNT_SUMMARY)
        val rows = jdbc.rows("SELECT a.*,e.email FROM identity_account a LEFT JOIN identity_email e ON e.account_id=a.id WHERE a.id IN (${accountIds.joinToString(",") { "?" }})",*accountIds.toTypedArray()).associateBy { it.uuid("id") }
        accountIds.mapNotNull { rows[it]?.let(::summary) }
    }
    fun listAccountSummariesForAdministrationInTransaction(adminContext: AdministrationProof, filters: AccountFilters, pageSpec: PageSpec): Page<AccountSummary> = tx.mandatory {
        page(pageSpec.page,pageSpec.pageSize); administration().validateAdministrationInTransaction(adminContext,AccountProjectionPurpose.ADMIN_ACCOUNT_SUMMARY)
        val conditions = mutableListOf("TRUE"); val args = mutableListOf<Any>()
        filters.accountCode?.let { if (!it.matches(Regex("QA[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}"))) invalid("accountCode"); conditions += "a.account_code=?"; args += it }
        filters.nicknameContains?.let { if (it.codePointCount(0,it.length) !in 1..40) invalid("nicknameContains"); conditions += "position(? in a.nickname)>0"; args += it }
        filters.status?.let { conditions += "a.status=?"; args += it.name }
        args += pageSpec.pageSize; args += (pageSpec.page.toLong()-1)*pageSpec.pageSize
        val rows = jdbc.rows("""WITH filtered AS (SELECT a.*,e.email FROM identity_account a LEFT JOIN identity_email e ON e.account_id=a.id WHERE ${conditions.joinToString(" AND ")}),
            paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT ? OFFSET ?)
            SELECT t.total,p.* FROM (SELECT count(*) total FROM filtered) t LEFT JOIN paged p ON TRUE ORDER BY p.created_at DESC,p.id""",*args.toTypedArray())
        Page(rows.filter { it["id"] != null }.map(::summary),pageSpec.page,pageSpec.pageSize,rows.first().number("total"))
    }
    fun setAccountStatus(lockedContext: StatusMutationProof, targetAccountId: UUID, status: AccountStatus, expectedVersion: Long, now: Instant): AccountStatusMutationResult = tx.mandatory {
        val guard = guards.existingAccountGuardInTransaction(targetAccountId); guards.assertAccountGuard(guard,LockMode.UPDATE)
        administration().validateStatusMutationInTransaction(lockedContext,targetAccountId,status)
        checkVersion(guard,expectedVersion)
        if (guard.status == status) AccountStatusMutationResult(targetAccountId,status,guard.version,guard.credentialVersion,false,emptyList())
        else {
            val after = bump(guard,now,status == AccountStatus.DISABLED)
            jdbc.update("UPDATE identity_account SET status=? WHERE id=?",status.name,targetAccountId)
            AccountStatusMutationResult(targetAccountId,status,after.number("version"),after.number("credential_version"),true,listOf(StatusChange("ACCOUNT_STATUS",guard.status.name,status.name))+versionChanges(guard,after))
        }
    }
    fun countActiveAccountsInTransaction(qualifiedAccountScope: QualifiedAccountScope, adminContext: AdministrationProof, mutationGuard: StatusMutationProof): Long = tx.mandatory {
        administration().validateQualifiedScopeInTransaction(qualifiedAccountScope,adminContext,mutationGuard)
        jdbc.queryForObject("SELECT count(*) FROM identity_account a JOIN admin_qualification q ON q.account_id=a.id AND q.qualified WHERE a.status='ACTIVE'",Long::class.java)!!
    }
}
