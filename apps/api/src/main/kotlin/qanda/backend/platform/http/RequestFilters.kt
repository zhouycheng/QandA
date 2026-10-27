package qanda.backend.platform.http

import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.InvalidMediaTypeException
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.UUID

object RequestIds {
    const val HEADER = "X-Request-Id"
    private const val ATTRIBUTE = "qanda.backend.requestId"

    fun get(request: HttpServletRequest): UUID = request.getAttribute(ATTRIBUTE) as? UUID
        ?: UUID.randomUUID().also { request.setAttribute(ATTRIBUTE, it) }

    fun set(request: HttpServletRequest, id: UUID) = request.setAttribute(ATTRIBUTE, id)
}

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestIdFilter(private val errors: ErrorWriter) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val values = request.getHeaders(RequestIds.HEADER).toList()
        val supplied = values.singleOrNull()?.takeIf { it.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) }?.let(UUID::fromString)
        val id = supplied ?: UUID.randomUUID()
        RequestIds.set(request, id)
        response.setHeader(RequestIds.HEADER, id.toString())
        MDC.put("requestId", id.toString())
        try {
            if (values.isNotEmpty() && (values.size != 1 || supplied == null)) {
                errors.write(request, response, ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_ID", "请求追踪号须为UUID"))
            } else chain.doFilter(request, response)
        } finally {
            MDC.remove("requestId")
        }
    }
}

object RequestBodies {
    const val MAX_JSON_BYTES = 8 * 1024 * 1024
    internal const val ATTRIBUTE = "qanda.backend.rawJson"
    fun bytes(request: HttpServletRequest): ByteArray = (request.getAttribute(ATTRIBUTE) as? ByteArray)?.clone()
        ?: error("Raw JSON is available only after JsonBodyFilter")
}

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
class JsonBodyFilter(private val errors: ErrorWriter) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        if (!request.requestURI.startsWith("/api/v1/") || request.contentType?.substringBefore(';')?.trim()?.lowercase() != MediaType.APPLICATION_JSON_VALUE) {
            chain.doFilter(request, response)
            return
        }
        try {
            if (request.contentLengthLong > RequestBodies.MAX_JSON_BYTES) throw tooLarge()
            val body = request.inputStream.readNBytes(RequestBodies.MAX_JSON_BYTES + 1)
            if (body.size > RequestBodies.MAX_JSON_BYTES) throw tooLarge()
            val charset = MediaType.parseMediaType(request.contentType).charset
            if (charset != null && charset != Charsets.UTF_8) throw ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "JSON请求须使用UTF-8")
            val decoded = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body))
            if (decoded.contains('\u0000')) throw ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请求JSON格式不正确")
            request.setAttribute(RequestBodies.ATTRIBUTE, body)
            chain.doFilter(BufferedJsonRequest(request, body), response)
        } catch (_: CharacterCodingException) {
            errors.write(request, response, ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "JSON请求须使用有效UTF-8"))
        } catch (_: InvalidMediaTypeException) {
            errors.write(request, response, ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "请求媒体类型不受支持"))
        } catch (error: ApiException) {
            errors.write(request, response, error)
        }
    }

    private fun tooLarge() = ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "JSON请求超过8MiB限制")
}

private class BufferedJsonRequest(request: HttpServletRequest, private val body: ByteArray) : HttpServletRequestWrapper(request) {
    override fun getInputStream(): ServletInputStream {
        val input = ByteArrayInputStream(body)
        return object : ServletInputStream() {
            override fun read() = input.read()
            override fun read(bytes: ByteArray, offset: Int, length: Int) = input.read(bytes, offset, length)
            override fun isFinished() = input.available() == 0
            override fun isReady() = true
            override fun setReadListener(listener: ReadListener) = throw UnsupportedOperationException("Synchronous JSON request body")
        }
    }
    override fun getReader() = BufferedReader(InputStreamReader(inputStream, Charsets.UTF_8))
}
