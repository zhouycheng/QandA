package qanda.backend.platform.mail

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.identity.IdentityService
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock

internal class MailDispatcher(private val outbox: JdbcMailOutbox, private val crypto: MailCrypto, private val transport: IdentityMailTransport, private val identity: ObjectProvider<IdentityService>, private val tx: JdbcTransactions, private val clock: Clock) {
    private val log = LoggerFactory.getLogger(javaClass)
    @Scheduled(fixedDelayString = "\${qanda.backend.mail.poll-delay-ms:1000}", initialDelayString = "\${qanda.backend.mail.poll-delay-ms:1000}")
    fun tick() {
        try { dispatchOne() }
        catch (error: Exception) { log.warn("Mail dispatcher deferred: exceptionType={}", error.javaClass.simpleName) }
    }
    internal fun dispatchOne(): Boolean {
        check(!TransactionSynchronizationManager.isActualTransactionActive())
        outbox.sweep()
        val lease = outbox.claim() ?: return false
        val result = try {
            val eligibility = tx.required { identity.getObject().checkIdentityMailEligibilityInTransaction(lease.envelope.challengeId, clock.instant()) }
            if (!eligibility.eligible || !lease.envelope.expiresAt.isAfter(clock.instant())) SendResult(SendState.CANCELLED, errorCode = "ELIGIBILITY_${eligibility.reasonCode}")
            else {
                val material = crypto.decrypt(lease.envelope)
                check(!TransactionSynchronizationManager.isActualTransactionActive())
                try { transport.send(lease.id, material) }
                catch (_: Exception) { SendResult(SendState.UNKNOWN, errorCode = "MAIL_TRANSPORT_RESULT_UNKNOWN") }
            }
        } catch (error: ApiException) {
            if (error.code == "MAIL_MATERIAL_INVALID") SendResult(SendState.PERMANENT_FAILED, errorCode = error.code)
            else SendResult(SendState.RETRYABLE_FAILED, errorCode = "MAIL_DEPENDENCY_UNAVAILABLE")
        } catch (_: Exception) { SendResult(SendState.RETRYABLE_FAILED, errorCode = "MAIL_DEPENDENCY_UNAVAILABLE") }
        outbox.record(lease, result)
        return true
    }
}
