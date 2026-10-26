package qanda.backend.identity

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.mail.IdentityMailPort
import qanda.backend.platform.mail.PreparedMailEnvelope
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

class IdentityTestClock : Clock() {
    val time = AtomicReference(Instant.parse("2026-10-26T04:00:55Z"))
    override fun instant() = time.get()
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    fun advance(seconds: Long) { time.updateAndGet { it.plusSeconds(seconds) } }
}
class IdentityTestMail(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions) : IdentityMailPort {
    val codes = ConcurrentHashMap<UUID,String>()
    var fail = false
    override fun prepareIdentityMailEnvelope(challengeId: UUID, recipient: String, code: String, templateCode: String, templateVersion: Int, expiresAt: Instant): PreparedMailEnvelope {
        codes[challengeId] = code
        return PreparedMailEnvelope(challengeId,templateCode,templateVersion,expiresAt,"test-ciphertext","test-nonce",1)
    }
    override fun enqueueIdentityMailInTransaction(challengeId: UUID, expiresAt: Instant, encryptedMessageRef: PreparedMailEnvelope, requestId: UUID): UUID = tx.mandatory {
        if (fail) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MAIL_UNAVAILABLE","测试邮件依赖故障")
        val id = UUID.randomUUID()
        jdbc.update("INSERT INTO identity_test_mail VALUES (?,?)",id,challengeId)
        id
    }
}
class IdentityTestAudit(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val guards: IdentityGuards) : IdentityAuditPort {
    var fail = false
    override fun appendIdentityAuditInTransaction(events: List<IdentityEvent>, membership: MembershipAudit?, requestId: UUID, now: Instant, transactionId: UUID) = tx.mandatory {
        guards.assertCurrentTransaction(transactionId)
        if (fail) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"AUDIT_UNAVAILABLE","测试审计依赖故障")
        for (event in events) jdbc.update("INSERT INTO identity_test_audit VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",event.eventId,event.action,event.actorAccountId)
        if (membership != null) jdbc.update("INSERT INTO identity_test_audit VALUES (?,?,?)",membership.eventId,"MEMBERSHIP_CHANGED",membership.accountId)
        Unit
    }
}
class IdentityTestMembership(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val guards: IdentityGuards) : IdentityMembershipPort {
    val college = UUID.fromString("10000000-0000-4000-8000-000000000001")
    val major = UUID.fromString("10000000-0000-4000-8000-000000000002")
    override fun prepareMembershipSelectionInTransaction(collegeId: UUID, majorId: UUID, identityGuard: AccountGuard): MembershipSelection = tx.mandatory {
        guards.assertAccountGuard(identityGuard,LockMode.UPDATE)
        if (collegeId != college || majorId != major) throw ApiException(HttpStatus.CONFLICT,"ORGANIZATION_UNAVAILABLE","测试组织选择无效")
        object : MembershipSelection {
            override val transactionId = identityGuard.transactionId
            override val accountId = identityGuard.accountId
            override val collegeId = collegeId
            override val majorId = majorId
        }
    }
    override fun initializeMembershipInTransaction(accountId: UUID, collegeId: UUID, majorId: UUID, selection: MembershipSelection, now: Instant): MembershipInitialization = tx.mandatory {
        guards.assertCurrentTransaction(selection.transactionId)
        jdbc.update("INSERT INTO identity_test_membership VALUES (?,?,?)",accountId,collegeId,majorId)
        MembershipInitialization(1,MembershipAudit(accountId,collegeId,majorId,UUID.randomUUID(),1))
    }
}
class IdentityTestAdmin(private val guards: IdentityGuards) : IdentityAdministrationPort {
    val administrators = ConcurrentHashMap.newKeySet<UUID>()
    class Proof(val transactionId: UUID) : StatusMutationProof, QualifiedAccountScope
    override fun hasAdminQualificationInTransaction(actor: GuardedActor): Boolean {
        guards.assertCurrentTransaction(actor.transactionId)
        return actor.auth.accountId in administrators
    }
    override fun validateAdministrationInTransaction(proof: AdministrationProof, purpose: AccountProjectionPurpose) = guards.assertCurrentTransaction((proof as Proof).transactionId)
    override fun validateStatusMutationInTransaction(proof: StatusMutationProof, targetAccountId: UUID, status: AccountStatus) = guards.assertCurrentTransaction((proof as Proof).transactionId)
    override fun validateQualifiedScopeInTransaction(scope: QualifiedAccountScope, proof: AdministrationProof, mutation: StatusMutationProof) {
        check(scope === proof && scope === mutation)
        guards.assertCurrentTransaction((scope as Proof).transactionId)
    }
}
@TestConfiguration
class IdentityTestProviders {
    @Bean @Primary fun identityClock() = IdentityTestClock()
    @Bean @Primary fun testMail(jdbc: JdbcTemplate, tx: JdbcTransactions) = IdentityTestMail(jdbc,tx)
    @Bean @Primary fun testAudit(jdbc: JdbcTemplate, tx: JdbcTransactions, guards: IdentityGuards) = IdentityTestAudit(jdbc,tx,guards)
    @Bean @Primary fun testMembership(jdbc: JdbcTemplate, tx: JdbcTransactions, guards: IdentityGuards) = IdentityTestMembership(jdbc,tx,guards)
    @Bean @Primary fun testAdmin(guards: IdentityGuards) = IdentityTestAdmin(guards)
}
