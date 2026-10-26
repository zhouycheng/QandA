package qanda.backend.platform.transaction

import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate

@Component
class JdbcTransactions(manager: PlatformTransactionManager) {
    private val required = TransactionTemplate(manager)
    private val mandatory = TransactionTemplate(manager).apply { propagationBehavior = TransactionDefinition.PROPAGATION_MANDATORY }
    private val snapshot = TransactionTemplate(manager).apply {
        isReadOnly = true
        isolationLevel = TransactionDefinition.ISOLATION_REPEATABLE_READ
    }

    fun <T : Any> required(block: () -> T): T = required.execute {
        check(!TransactionSynchronizationManager.isCurrentTransactionReadOnly()) { "A write root cannot join a READ ONLY transaction" }
        block()
    }!!

    fun <T : Any> mandatory(block: () -> T): T = mandatory.execute {
        check(!TransactionSynchronizationManager.isCurrentTransactionReadOnly()) { "A write consumer requires the current READ WRITE transaction" }
        block()
    }!!

    fun <T : Any> readOnlySnapshot(block: () -> T): T {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Start the dedicated source snapshot outside an existing transaction" }
        return snapshot.execute { block() }!!
    }
}
