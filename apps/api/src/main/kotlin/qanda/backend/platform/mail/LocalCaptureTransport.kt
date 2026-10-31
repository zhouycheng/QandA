package qanda.backend.platform.mail

import jakarta.annotation.PreDestroy
import jakarta.mail.internet.InternetAddress
import org.springframework.core.env.Environment
import org.springframework.mail.javamail.JavaMailSenderImpl
import java.net.ConnectException
import java.util.UUID
import java.util.concurrent.*

internal interface IdentityMailTransport { fun send(deliveryId: UUID, material: MailMaterial): SendResult }

internal class LocalCaptureTransport(environment: Environment) : IdentityMailTransport {
    private val sender = JavaMailSenderImpl()
    private val executor = ThreadPoolExecutor(1, 1, 0L, TimeUnit.SECONDS, SynchronousQueue(), { runnable -> Thread(runnable, "local-mail-capture").apply { isDaemon = true } }, ThreadPoolExecutor.AbortPolicy())
    init {
        require(environment.getProperty("qanda.backend.mode", "production") in setOf("local", "test")) { "本地邮件捕获只可用于显式local/test模式" }
        val host = environment.getProperty("qanda.backend.mail.host", "127.0.0.1")
        require(host in setOf("127.0.0.1", "localhost", "::1") || host=="mailpit" && environment.getProperty("BACKEND_LOCAL_CONTAINER",Boolean::class.java,false)) { "本地捕获SMTP仅允许回环地址或显式本地容器的mailpit服务" }
        sender.host = host
        sender.port = environment.getProperty("qanda.backend.mail.port", Int::class.java, 51025).also { require(it in 1..65535) }
        sender.defaultEncoding = "UTF-8"
        sender.javaMailProperties.putAll(mapOf("mail.smtp.connectiontimeout" to "3000", "mail.smtp.timeout" to "3000", "mail.smtp.writetimeout" to "3000", "mail.debug" to "false"))
    }

    override fun send(deliveryId: UUID, material: MailMaterial): SendResult {
        val future = try { executor.submit<SendResult> {
            val message = sender.createMimeMessage()
            message.setFrom(InternetAddress("qanda-local@example.test"))
            message.setRecipient(jakarta.mail.Message.RecipientType.TO, InternetAddress(material.recipient, true))
            message.setSubject("QandA 邮箱验证码", "UTF-8")
            message.setText("您的验证码：${material.code}\n验证码由服务端验证并按挑战期限失效。", "UTF-8")
            message.setHeader("X-Qanda-Delivery-Id", deliveryId.toString())
            sender.send(message)
            SendResult(SendState.ACCEPTED, message.messageID)
        } } catch (_: RejectedExecutionException) { return SendResult(SendState.RETRYABLE_FAILED, errorCode = "LOCAL_TRANSPORT_BUSY") }
        return try { future.get(10, TimeUnit.SECONDS) }
        catch (_: TimeoutException) { future.cancel(true); SendResult(SendState.UNKNOWN, errorCode = "SMTP_TIMEOUT_UNKNOWN") }
        catch (error: ExecutionException) {
            val causes = generateSequence(error.cause) { it.cause }.take(10).toList()
            if (causes.any { it is ConnectException }) SendResult(SendState.RETRYABLE_FAILED, errorCode = "SMTP_CONNECT_FAILED")
            else SendResult(SendState.UNKNOWN, errorCode = "SMTP_RESULT_UNKNOWN")
        } catch (_: InterruptedException) {
            future.cancel(true); Thread.currentThread().interrupt(); SendResult(SendState.UNKNOWN, errorCode = "SMTP_INTERRUPTED_UNKNOWN")
        }
    }
    @PreDestroy fun shutdown() { executor.shutdownNow() }
}
