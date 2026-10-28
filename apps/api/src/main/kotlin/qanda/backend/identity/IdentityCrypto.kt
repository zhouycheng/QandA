package qanda.backend.identity

import org.springframework.core.env.Environment
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import qanda.backend.identity.api.PreparedPassword
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.FieldError
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.Locale
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

internal fun invalid(field: String): Nothing = throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "请检查请求字段", listOf(FieldError("/$field", "INVALID_FIELD", "字段不符合要求")))
internal fun conflict(code: String, message: String): Nothing = throw ApiException(HttpStatus.CONFLICT, code, message)
internal fun unavailable(code: String): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, "所需服务暂时不可用")
internal fun unauthenticated(): Nothing = throw ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "请提供有效令牌")
internal fun invalidProof(): Nothing = throw ApiException(HttpStatus.CONFLICT, "VERIFICATION_FAILED", "验证证明无效或已失效")
internal fun nickname(value: String): String = value.trim().also {
    if (it.codePointCount(0,it.length) !in 1..40 || it.any { c -> c.code < 32 || c.code == 127 }) invalid("nickname")
}
internal data class Email(val display: String, val key: String)
internal fun email(value: String, field: String = "email"): Email {
    if (value.any { it == '\r' || it == '\n' || it == '\u0000' }) invalid(field)
    val text = value.trim()
    val at = text.lastIndexOf('@')
    if (text.length !in 3..254 || text.any { it.code !in 33..126 } || at !in 1..64 || at != text.indexOf('@')) invalid(field)
    val local = text.substring(0,at)
    val domain = text.substring(at+1)
    if (local.startsWith('.') || local.endsWith('.') || ".." in local || !local.matches(Regex("[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+")) ||
        domain.length > 253 || domain.split('.').any { !it.matches(Regex("[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")) }) invalid(field)
    return Email(text,text.lowercase(Locale.ROOT))
}
internal fun code(value: String) { if (!value.matches(Regex("[0-9]{6}"))) invalid("code") }
internal fun wechatCode(value: String) { if (value.length !in 1..512 || value.any { it.code < 32 || it.code == 127 }) invalid("code") }
internal fun token(value: String) { if (!value.matches(Regex("[A-Za-z0-9_-]{43}"))) invalid("registrationToken") }

@Component
class IdentityCrypto(private val environment: Environment) {
    private val random = SecureRandom()
    private val base64 = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()
    private val iterations = 600_000
    private val keys: Map<Int, ByteArray> by lazy {
        try {
            val entries = environment.getRequiredProperty("BACKEND_IDENTITY_MAC_KEYS").split(',').map {
                val parts = it.split(':',limit=2)
                parts[0].toInt() to Base64.getDecoder().decode(parts[1])
            }
            require(entries.isNotEmpty() && entries.map { it.first }.distinct().size == entries.size && entries.all { it.first in 1..32767 && it.second.size >= 32 })
            entries.toMap()
        } catch (_: Exception) { unavailable("IDENTITY_KEY_UNAVAILABLE") }
    }
    val activeVersion: Int get() = environment.getProperty("BACKEND_IDENTITY_MAC_ACTIVE_VERSION", Int::class.java, 1).also {
        if (it !in keys.keys) unavailable("IDENTITY_KEY_UNAVAILABLE")
    }
    private val rateKey: ByteArray by lazy {
        try { Base64.getDecoder().decode(environment.getRequiredProperty("BACKEND_IDENTITY_RATE_KEY")).also { require(it.size >= 32) } }
        catch (_: Exception) { unavailable("IDENTITY_KEY_UNAVAILABLE") }
    }
    private val dummy: String by lazy { preparePassword("identity-dummy-password").encoded }
    fun randomToken(): String = base64.encodeToString(ByteArray(32).also(random::nextBytes))
    fun randomCode(): String = random.nextInt(1_000_000).toString().padStart(6,'0')
    fun accountCode(): String {
        val alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        return "QA" + (1..10).map { alphabet[random.nextInt(32)] }.joinToString("")
    }
    fun tokenDigest(value: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(UTF_8))
    fun proofMac(id: UUID, purpose: String, code: String, version: Int = activeVersion): ByteArray = hmac(
        keys[version] ?: unavailable("IDENTITY_KEY_UNAVAILABLE"), "proof\u0000$id\u0000$purpose\u0000$code")
    fun rateDigest(value: String): ByteArray = hmac(rateKey, "rate\u0000$value")
    fun matches(left: ByteArray, right: ByteArray) = MessageDigest.isEqual(left,right)
    private fun hmac(key: ByteArray, value: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key,"HmacSHA256")); doFinal(value.toByteArray(UTF_8))
    }
    fun preparePassword(raw: String): PreparedPassword {
        validatePassword(raw)
        val salt = ByteArray(16).also(random::nextBytes)
        return PreparedPassword(listOf("{pbkdf2-sha256}",iterations.toString(),base64.encodeToString(salt),base64.encodeToString(derive(raw,salt,iterations))).joinToString("$"))
    }
    fun verifyPassword(raw: String, encoded: String?): Boolean {
        validatePassword(raw)
        return try {
            val parts = (encoded ?: dummy).split('$')
            require(parts.size == 4 && parts[0] == "{pbkdf2-sha256}" && parts[1] == iterations.toString())
            val salt = decoder.decode(parts[2]); val expected = decoder.decode(parts[3])
            require(salt.size == 16 && expected.size == 32)
            val matched = matches(derive(raw,salt,iterations),expected)
            encoded != null && matched
        } catch (_: IllegalArgumentException) { false }
    }
    private fun validatePassword(raw: String) {
        if (raw.codePointCount(0,raw.length) !in 12..128 || raw.toByteArray(UTF_8).size > 512 || raw.any { it == '\u0000' } ||
            raw.indices.any { Character.isSurrogate(raw[it]) && !(Character.isHighSurrogate(raw[it]) && it+1 < raw.length && Character.isLowSurrogate(raw[it+1])) && !(Character.isLowSurrogate(raw[it]) && it>0 && Character.isHighSurrogate(raw[it-1])) }) invalid("password")
    }
    private fun derive(raw: String, salt: ByteArray, rounds: Int): ByteArray {
        val spec = PBEKeySpec(raw.toCharArray(),salt,rounds,256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded } finally { spec.clearPassword() }
    }
}
