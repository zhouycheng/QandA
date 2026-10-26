package qanda.backend.platform.mail

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.tencentcloudapi.common.exception.TencentCloudSDKException
import com.tencentcloudapi.ses.v20201002.SesClient
import com.tencentcloudapi.ses.v20201002.models.SendEmailRequest
import com.tencentcloudapi.ses.v20201002.models.SendEmailResponse
import okhttp3.OkHttpClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.mock.env.MockEnvironment
import qanda.backend.platform.http.ApiException
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID

@Tag("platform-acceptance")
@Tag("platform-boundary")
class MailTransportContractTest {
    private val now = Instant.parse("2026-10-26T00:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val mapper = jacksonObjectMapper()
    private fun settings(enabled: Boolean = false) = MockEnvironment().withProperty("TENCENT_SECRET_ID", "test-only-secret-id")
        .withProperty("TENCENT_SECRET_KEY", "test-only-secret-key").withProperty("TENCENT_SES_REGION", "ap-guangzhou")
        .withProperty("TENCENT_SES_FROM_EMAIL", "fixture-sender@example.test").withProperty("TENCENT_SES_VERIFICATION_TEMPLATE_ID", "123")
        .withProperty("BACKEND_SES_SEND_ENABLED", enabled.toString())
    private fun material() = MailMaterial("fixture-recipient@example.test", "123456", now.plusSeconds(601), "IDENTITY_REGISTER")

    @Test fun `cloud-disabled mode never calls SES and template requires its own approved id`() {
        val client = mock(SesClient::class.java)
        val transport = TencentSesTransport(TencentSesSettings(settings()), client, mapper, clock)
        assertEquals("SES_SEND_NOT_AUTHORIZED", transport.send(UUID.randomUUID(), material()).errorCode)
        verifyNoInteractions(client)
        val missing = settings().apply { setProperty("TENCENT_SES_VERIFICATION_TEMPLATE_ID", ""); setProperty("TENCENT_SES_EXISTING_LOGIN_TEMPLATE_ID", "456") }
        assertThrows(IllegalStateException::class.java) { TencentSesSettings(missing) }
    }

    @Test fun `reviewable SDK request has exactly one recipient and approved three-variable mapping`() {
        val transport = TencentSesTransport(TencentSesSettings(settings()), mock(SesClient::class.java), mapper, clock)
        val request = transport.request(material())
        assertEquals(listOf("fixture-recipient@example.test"), request.destination.toList())
        assertEquals("QandA 邮箱验证", request.subject)
        assertEquals(123L, request.template.templateID)
        val data = mapper.readTree(request.template.templateData)
        assertEquals(setOf("app_name", "code", "expire_minutes"), data.fieldNames().asSequence().toSet())
        assertEquals("QandA", data["app_name"].asText()); assertEquals("123456", data["code"].asText()); assertEquals(11, data["expire_minutes"].asInt())
        val client = TencentSesTransport.client(TencentSesSettings(settings()))
        val http = client.clientProfile.httpProfile.httpClient as OkHttpClient
        assertFalse(http.retryOnConnectionFailure); assertFalse(http.followRedirects); assertFalse(http.followSslRedirects)
        assertEquals(10000, http.callTimeoutMillis); assertFalse(client.clientProfile.isDebug); assertNull(client.clientProfile.backupEndpoint)
    }

    @Test fun `one API call records acceptance and unknown SDK results never become blind retries`() {
        val success = mock(SesClient::class.java)
        `when`(success.SendEmail(any(SendEmailRequest::class.java))).thenReturn(SendEmailResponse().apply { messageId = "isolated-fixture-message" })
        assertEquals(SendState.ACCEPTED, TencentSesTransport(TencentSesSettings(settings(true)), success, mapper, clock).send(UUID.randomUUID(), material()).state)
        verify(success, times(1)).SendEmail(any(SendEmailRequest::class.java))
        for ((code, state) in listOf("RequestLimitExceeded" to SendState.RETRYABLE_FAILED, "AuthFailure.SecretIdNotFound" to SendState.PERMANENT_FAILED, "ClientSideError" to SendState.UNKNOWN)) {
            val client = mock(SesClient::class.java)
            `when`(client.SendEmail(any(SendEmailRequest::class.java))).thenThrow(TencentCloudSDKException("sensitive fixture never logged", "isolated-request", code))
            assertEquals(state, TencentSesTransport(TencentSesSettings(settings(true)), client, mapper, clock).send(UUID.randomUUID(), material()).state)
            verify(client, times(1)).SendEmail(any(SendEmailRequest::class.java))
        }
    }

    @Test fun `encrypted material authenticates context and survives retained key rotation`() {
        fun key(value: Int) = Base64.getEncoder().encodeToString(ByteArray(32) { value.toByte() })
        val original = MailCrypto(mapper, MockEnvironment().withProperty("BACKEND_MAIL_ENCRYPTION_KEYS", "1:${key(1)}"))
        val id = UUID.randomUUID()
        val envelope = original.prepare(id, "fixture@example.test", "123456", "IDENTITY_REGISTER", 1, now.plusSeconds(600))
        assertFalse(envelope.ciphertext.contains("fixture@example.test"))
        val rotated = MailCrypto(mapper, MockEnvironment().withProperty("BACKEND_MAIL_ENCRYPTION_KEYS", "1:${key(1)},2:${key(2)}").withProperty("BACKEND_MAIL_ENCRYPTION_ACTIVE_VERSION", "2"))
        assertEquals("123456", rotated.decrypt(envelope).code)
        val tampered = PreparedMailEnvelope(UUID.randomUUID(), envelope.templateCode, envelope.templateVersion, envelope.expiresAt, envelope.ciphertext, envelope.nonce, envelope.keyVersion)
        assertEquals("MAIL_MATERIAL_INVALID", assertThrows(ApiException::class.java) { rotated.decrypt(tampered) }.code)
        val removed = MailCrypto(mapper, MockEnvironment().withProperty("BACKEND_MAIL_ENCRYPTION_KEYS", "2:${key(2)}").withProperty("BACKEND_MAIL_ENCRYPTION_ACTIVE_VERSION", "2"))
        assertEquals("MAIL_KEY_UNAVAILABLE", assertThrows(ApiException::class.java) { removed.decrypt(envelope) }.code)
        assertFalse(original.decrypt(envelope).toString().contains("123456"))
    }
}
