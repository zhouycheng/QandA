package qanda.backend.identity

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.persistence.SystemMapper
import qanda.backend.platform.mail.OutboxService
import java.time.Clock
import java.util.UUID

@Service
class ChallengeService(private val sql: IdentityMapper, private val rows: EmailChallengeMapper, private val users: UserAccountMapper,
                       private val crypto: IdentityCrypto, private val outbox: OutboxService, private val system: SystemMapper,
                       private val clock: Clock, manager: PlatformTransactionManager) {
    private val verification=TransactionTemplate(manager).apply { propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW }

    fun issue(input: ChallengeInput, actorId: UUID?): ChallengeView {
        val user=actorId?.let { users.selectById(it) ?: unauthenticated() }
        val address=when(input.purpose) {
            "REGISTER","RESET_PASSWORD" -> { if(user!=null) invalid("purpose"); email(input.email ?: invalid("email")) }
            "BIND_EMAIL","CHANGE_EMAIL_NEW" -> { if(user==null) unauthenticated();email(input.email ?: invalid("email")) }
            "CHANGE_PASSWORD","CHANGE_EMAIL_OLD" -> email(user?.email ?: invalid("email"))
            else -> invalid("purpose")
        }
        system.lock("email:${address.key}")
        sql.recentChallenge(address.key)?.let { if(it.plusSeconds(60).isAfter(clock.instant())) throw ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","请稍后再发送",details=ErrorDetails(retryAfterSeconds=60)) }
        val owner=sql.userByEmail(address.key)
        val eligible=when(input.purpose) {
            "REGISTER" -> owner==null
            "RESET_PASSWORD" -> owner?.status=="ACTIVE"
            "BIND_EMAIL" -> owner==null && user?.email==null
            "CHANGE_EMAIL_NEW" -> owner==null
            else -> user?.status=="ACTIVE"
        }
        val code=crypto.randomCode()
        val row=EmailChallenge().apply { id=UUID.randomUUID();userId=if(input.purpose=="RESET_PASSWORD") owner?.id else user?.id
            purpose=input.purpose;email=address.display;emailKey=address.key;codeMac=crypto.proofMac(id!!,purpose,code);keyVersion=crypto.activeVersion
            this.eligible=eligible;credentialVersion=(user?:owner)?.credentialVersion;createdAt=clock.instant();expiresAt=createdAt.plusSeconds(600) }
        rows.insert(row)
        if(eligible) outbox.enqueue(row,code)
        return ChallengeView(row.id!!,row.expiresAt)
    }

    fun verify(id: UUID, submitted: String) {
        code(submitted)
        val valid=verification.execute {
            val row=sql.lockChallenge(id) ?: return@execute false
            if(row.consumedAt!=null || row.failedAttempts>=5 || !row.expiresAt.isAfter(clock.instant())) return@execute false
            val matches=crypto.matches(row.codeMac,crypto.proofMac(id,row.purpose,submitted,row.keyVersion))
            if(!matches) sql.failChallenge(id)
            matches && row.eligible
        } == true
        if(!valid) invalidProof()
    }

    fun consume(id: UUID, purpose: String, userId: UUID?): EmailChallenge {
        val row=sql.lockChallenge(id) ?: invalidProof()
        if(row.purpose!=purpose || row.userId!=userId || !row.eligible || row.consumedAt!=null || row.failedAttempts>=5 || !row.expiresAt.isAfter(clock.instant())) invalidProof()
        if(userId!=null && row.credentialVersion!=users.selectById(userId)?.credentialVersion) invalidProof()
        sql.consumeChallenge(id)
        return row
    }
}
