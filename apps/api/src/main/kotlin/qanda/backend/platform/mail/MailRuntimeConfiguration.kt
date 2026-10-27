package qanda.backend.platform.mail

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.EnableScheduling
import qanda.backend.identity.IdentityService
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Clock

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = ["qanda.backend.mail.enabled"], havingValue = "true")
class MailRuntimeConfiguration {
    @Bean fun mailCrypto(mapper: ObjectMapper, environment: Environment) = MailCrypto(mapper, environment)
    @Bean fun mailOutbox(jdbc: JdbcTemplate, tx: JdbcTransactions, crypto: MailCrypto, clock: Clock) = JdbcMailOutbox(jdbc, tx, crypto, clock)
    @Bean internal fun identityMailTransport(environment: Environment, mapper: ObjectMapper, clock: Clock): IdentityMailTransport {
        return when (environment.getProperty("qanda.backend.mail.transport", "unconfigured")) {
            "local-capture" -> LocalCaptureTransport(environment)
            "tencent-ses" -> TencentSesSettings(environment).let { settings -> TencentSesTransport(settings, TencentSesTransport.client(settings), mapper, clock) }
            else -> error("邮件传输须明确配置为腾讯云SES或local/test本地捕获")
        }
    }
    @Bean
    @ConditionalOnProperty(name = ["qanda.backend.mail.dispatch-enabled"], havingValue = "true", matchIfMissing = true)
    internal fun mailDispatcher(outbox: JdbcMailOutbox, crypto: MailCrypto, transport: IdentityMailTransport, identity: ObjectProvider<IdentityService>, tx: JdbcTransactions, clock: Clock) = MailDispatcher(outbox, crypto, transport, identity, tx, clock)
}
