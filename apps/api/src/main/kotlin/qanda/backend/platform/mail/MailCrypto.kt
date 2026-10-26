package qanda.backend.platform.mail

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.core.env.Environment
import org.springframework.http.HttpStatus
import qanda.backend.platform.http.ApiException
import java.security.MessageDigest
import java.security.SecureRandom
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal val IDENTITY_MAIL_TEMPLATES = setOf("REGISTER", "RESET_PASSWORD", "BIND_EMAIL", "CHANGE_PASSWORD", "CHANGE_EMAIL_OLD", "CHANGE_EMAIL_NEW").map { "IDENTITY_$it" }.toSet()
internal fun mailUnavailable(code: String = "MAIL_UNAVAILABLE"): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, "邮件服务暂时不可用")
internal fun mailConflict(): Nothing = throw ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "同一邮件意图的封装不同")
internal class MailMaterial(val recipient: String, val code: String, val expiresAt: Instant, val templateCode: String) {
    override fun toString() = "MailMaterial([REDACTED])"
}

class MailCrypto(private val mapper: ObjectMapper, environment: Environment) {
    private val random = SecureRandom()
    private val encoder = Base64.getEncoder()
    private val decoder = Base64.getDecoder()
    private val keys = try {
        val entries = environment.getRequiredProperty("BACKEND_MAIL_ENCRYPTION_KEYS").split(',').map {
            val parts = it.split(':', limit = 2)
            require(parts.size == 2)
            parts[0].toInt() to decoder.decode(parts[1])
        }
        require(entries.isNotEmpty() && entries.map { it.first }.distinct().size == entries.size)
        require(entries.all { it.first in 1..32767 && it.second.size == 32 })
        entries.toMap()
    } catch (_: Exception) { error("邮件加密密钥须为不重复的version:base64，AES密钥为32字节") }
    private val active = environment.getProperty("BACKEND_MAIL_ENCRYPTION_ACTIVE_VERSION", Int::class.java, 1).also {
        require(it in keys) { "邮件活动密钥版本缺失" }
    }

    fun prepare(id: UUID, recipient: String, code: String, template: String, version: Int, expiry: Instant): PreparedMailEnvelope {
        require(template in IDENTITY_MAIL_TEMPLATES && version == 1)
        require(recipient.length in 3..254 && recipient.none { it == '\r' || it == '\n' || it == '\u0000' } && code.matches(Regex("[0-9]{6}")))
        val expires = expiry.truncatedTo(ChronoUnit.MILLIS)
        val nonce = ByteArray(12).also(random::nextBytes)
        val material = mapper.writeValueAsBytes(mapOf("recipient" to recipient, "code" to code))
        require(material.size <= 4096)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keys.getValue(active), "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad(id, template, version, expires))
        return try { PreparedMailEnvelope(id, template, version, expires, encoder.encodeToString(cipher.doFinal(material)), encoder.encodeToString(nonce), active) }
        finally { material.fill(0) }
    }

    internal fun decrypt(envelope: PreparedMailEnvelope): MailMaterial {
        val key = keys[envelope.keyVersion] ?: mailUnavailable("MAIL_KEY_UNAVAILABLE")
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, decoder.decode(envelope.nonce)))
            cipher.updateAAD(aad(envelope.challengeId, envelope.templateCode, envelope.templateVersion, envelope.expiresAt))
            val bytes = cipher.doFinal(decoder.decode(envelope.ciphertext))
            return try {
                val value = mapper.readTree(bytes)
                require(value.isObject && value.size() == 2 && value["recipient"].isTextual && value["code"].asText().matches(Regex("[0-9]{6}")))
                MailMaterial(value["recipient"].asText(), value["code"].asText(), envelope.expiresAt, envelope.templateCode)
            } finally { bytes.fill(0) }
        } catch (error: ApiException) { throw error }
        catch (_: Exception) { mailUnavailable("MAIL_MATERIAL_INVALID") }
    }

    internal fun fingerprint(envelope: PreparedMailEnvelope): ByteArray = MessageDigest.getInstance("SHA-256").digest(
        mapper.writeValueAsBytes(listOf(envelope.challengeId.toString(), envelope.templateCode, envelope.templateVersion.toString(), envelope.expiresAt.toString(), envelope.keyVersion.toString(), envelope.nonce, envelope.ciphertext)))
    private fun aad(id: UUID, template: String, version: Int, expiry: Instant): ByteArray = ByteArrayOutputStream().also { output ->
        DataOutputStream(output).use { framed ->
            for (part in listOf(id.toString(), template, version.toString(), expiry.toString())) {
                val bytes = part.toByteArray(Charsets.UTF_8)
                framed.writeLong(bytes.size.toLong()); framed.write(bytes)
            }
        }
    }.toByteArray()
}
