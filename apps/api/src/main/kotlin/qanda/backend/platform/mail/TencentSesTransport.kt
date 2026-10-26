package qanda.backend.platform.mail

import com.fasterxml.jackson.databind.ObjectMapper
import com.tencentcloudapi.common.Credential
import com.tencentcloudapi.common.exception.TencentCloudSDKException
import com.tencentcloudapi.common.profile.ClientProfile
import com.tencentcloudapi.common.profile.HttpProfile
import com.tencentcloudapi.ses.v20201002.SesClient
import com.tencentcloudapi.ses.v20201002.models.SendEmailRequest
import com.tencentcloudapi.ses.v20201002.models.Template
import org.springframework.core.env.Environment
import okhttp3.OkHttpClient
import java.time.Clock
import java.time.Duration
import java.util.UUID
import java.util.concurrent.TimeUnit

internal class TencentSesSettings(environment: Environment) {
    val secretId = environment.getProperty("TENCENT_SECRET_ID")?.takeIf { it.isNotBlank() } ?: error("SES SecretId尚未配置")
    val secretKey = environment.getProperty("TENCENT_SECRET_KEY")?.takeIf { it.isNotBlank() } ?: error("SES SecretKey尚未配置")
    val region = environment.getProperty("TENCENT_SES_REGION")?.takeIf { it in setOf("ap-guangzhou", "ap-hongkong") } ?: error("SES地域须为产品支持的广州或香港")
    val from = environment.getProperty("TENCENT_SES_FROM_EMAIL")?.takeIf { it.length in 3..254 && '@' in it && it.none { c -> c == '\r' || c == '\n' } } ?: error("SES已验证发信地址尚未配置")
    val templateId = environment.getProperty("TENCENT_SES_VERIFICATION_TEMPLATE_ID")?.toLongOrNull()?.takeIf { it > 0 } ?: error("SES通用验证模板须另经用户确认和审核，不能复用登录专用文案")
    val sendEnabled = environment.getProperty("BACKEND_SES_SEND_ENABLED", Boolean::class.java, false)
    override fun toString() = "TencentSesSettings([REDACTED])"
}

internal class TencentSesTransport(private val settings: TencentSesSettings, private val client: SesClient, private val mapper: ObjectMapper, private val clock: Clock) : IdentityMailTransport {
    internal fun request(material: MailMaterial): SendEmailRequest = SendEmailRequest().apply {
        fromEmailAddress = settings.from
        destination = arrayOf(material.recipient)
        subject = "QandA 邮箱验证"
        template = Template().apply {
            templateID = settings.templateId
            templateData = mapper.writeValueAsString(mapOf("app_name" to "QandA", "code" to material.code, "expire_minutes" to ((Duration.between(clock.instant(), material.expiresAt).seconds.coerceAtLeast(1) + 59) / 60)))
        }
    }
    override fun send(deliveryId: UUID, material: MailMaterial): SendResult {
        if (!settings.sendEnabled) return SendResult(SendState.RETRYABLE_FAILED, errorCode = "SES_SEND_NOT_AUTHORIZED")
        return try {
            val response = client.SendEmail(request(material))
            response.messageId?.takeIf { it.isNotBlank() }?.let { SendResult(SendState.ACCEPTED, it.take(256)) }
                ?: SendResult(SendState.UNKNOWN, errorCode = "SES_RESULT_UNKNOWN")
        } catch (error: TencentCloudSDKException) {
            val code = error.errorCode.orEmpty()
            when {
                code.startsWith("RequestLimitExceeded") -> SendResult(SendState.RETRYABLE_FAILED, errorCode = "SES_RATE_REJECTED")
                code.startsWith("AuthFailure") || code.startsWith("InvalidParameter") || code.startsWith("UnauthorizedOperation") -> SendResult(SendState.PERMANENT_FAILED, errorCode = "SES_CONFIGURATION_REJECTED")
                else -> SendResult(SendState.UNKNOWN, errorCode = "SES_RESULT_UNKNOWN")
            }
        }
    }
    companion object {
        fun client(settings: TencentSesSettings): SesClient {
            val http = HttpProfile().apply {
                endpoint = "ses.tencentcloudapi.com"; connTimeout = 3; readTimeout = 5; writeTimeout = 5
                httpClient = OkHttpClient.Builder().connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
                    .writeTimeout(5, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS).retryOnConnectionFailure(false)
                    .followRedirects(false).followSslRedirects(false).build()
            }
            val profile = ClientProfile().apply { httpProfile = http; setDebug(false) }
            return SesClient(Credential(settings.secretId, settings.secretKey), settings.region, profile)
        }
    }
}
