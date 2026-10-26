package qanda.backend.content

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import jakarta.servlet.FilterChain
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import qanda.backend.platform.http.*

/** Minimal real-filter reproduction, executable without a database or business test doubles. */
class ContentEarlyErrorHeadersTest {
    @Test fun `invalid UTF8 rejected before security still has one trace and no store header`() {
        val request=MockHttpServletRequest("POST","/api/v1/subjects").apply { contentType="application/json";setContent(byteArrayOf(0xc3.toByte(),0x28)) }
        val response=MockHttpServletResponse();val errors=ErrorWriter(jacksonObjectMapper())
        RequestIdFilter(errors).doFilter(request,response,FilterChain { req,res ->
            JsonBodyFilter(errors).doFilter(req,res,FilterChain { _,_ -> fail("Invalid UTF-8 must be rejected before controller/security") })
        })
        assertEquals(400,response.status)
        assertEquals(1,response.getHeaders("X-Request-Id").size)
        assertEquals(listOf("no-store"),response.getHeaders("Cache-Control").toList())
    }
}
