package qanda.backend.platform.security

import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import qanda.backend.platform.http.ApiException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class CommandDigests(val activeVersion: Int, keys: Map<Int, ByteArray>) {
    private val keys = keys.mapValues { (_, value) -> value.clone() }
    init {
        require(activeVersion in 1..32767 && keys.containsKey(activeVersion)) { "Active command digest key is missing" }
        require(keys.keys.all { it in 1..32767 } && keys.values.all { it.size >= 32 }) { "Command digest keys require valid versions and at least 32 bytes" }
    }

    fun digest(method: String, path: String, contentType: String, rawBody: ByteArray, keyVersion: Int = activeVersion): ByteArray {
        val key = keys[keyVersion] ?: throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "IDEMPOTENCY_KEY_UNAVAILABLE", "请求摘要密钥暂不可用")
        require(path.startsWith("/api/v1/") && '?' !in path && '#' !in path) { "Use a canonical API resource path without query" }
        val canonicalPath = path.split('/').joinToString("/") { part ->
            if (part.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))) UUID.fromString(part).toString() else part
        }
        val media = MediaType.parseMediaType(contentType)
        val framed = MessageDigest.getInstance("SHA-256")
        for (segment in listOf(method.uppercase(Locale.ROOT).toByteArray(Charsets.UTF_8), canonicalPath.toByteArray(Charsets.UTF_8), "${media.type.lowercase(Locale.ROOT)}/${media.subtype.lowercase(Locale.ROOT)}".toByteArray(Charsets.UTF_8), rawBody)) {
            framed.update(ByteBuffer.allocate(8).putLong(segment.size.toLong()).array())
            framed.update(segment)
        }
        return Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(framed.digest())
        }
    }

    fun matches(expected: ByteArray, actual: ByteArray) = MessageDigest.isEqual(expected, actual)
}
