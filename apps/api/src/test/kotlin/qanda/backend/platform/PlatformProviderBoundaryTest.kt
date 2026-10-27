package qanda.backend.platform

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import qanda.backend.platform.config.ProviderConfigurationGuard
import qanda.backend.platform.http.*
import java.util.UUID

@Tag("platform-acceptance")
@Tag("platform-boundary")
class PlatformProviderBoundaryTest {
    @Test fun `production fails closed before migration when official providers are absent`() {
        val guard = ProviderConfigurationGuard()
        assertThrows(IllegalArgumentException::class.java) { guard.validate(MockEnvironment().withProperty("qanda.backend.mode", "production").withProperty("BACKEND_WECHAT_PROVIDER", "local")) }
        assertThrows(IllegalArgumentException::class.java) { guard.validate(MockEnvironment().withProperty("qanda.backend.mode", "production")) }
        assertDoesNotThrow { guard.validate(MockEnvironment().withProperty("qanda.backend.mode", "test").withProperty("BACKEND_WECHAT_PROVIDER", "local")) }
    }
    @Test fun `rate-limit details produce matching Retry-After through both error paths`() {
        val request = MockHttpServletRequest().apply { RequestIds.set(this, UUID.randomUUID()) }
        val error = ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "请稍后重试", details = ErrorDetails(retryAfterSeconds = 60))
        val response = MockHttpServletResponse()
        ErrorWriter(jacksonObjectMapper()).write(request, response, error)
        assertEquals(429, response.status); assertEquals("60", response.getHeader("Retry-After"))
        val advised = ApiExceptionHandler().business(error, request)
        assertEquals("60", advised.headers.getFirst("Retry-After")); assertEquals(60, advised.body!!.details!!.retryAfterSeconds)
    }
}
