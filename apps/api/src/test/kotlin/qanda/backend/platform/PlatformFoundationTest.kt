package qanda.backend.platform

import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.KotlinModule
import jakarta.servlet.http.HttpServletRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.bind.annotation.*
import qanda.backend.platform.config.BackendSafety
import qanda.backend.platform.config.PlatformConfiguration
import qanda.backend.platform.http.*
import qanda.backend.platform.security.CommandDigests
import java.time.Instant

class PlatformFoundationTest {
    private val builder = Jackson2ObjectMapperBuilder.json().modules(KotlinModule.Builder().build(), JavaTimeModule())
    private val mapper = builder.also { PlatformConfiguration().strictJson().customize(it) }.build<com.fasterxml.jackson.databind.ObjectMapper>()
    private val writer = ErrorWriter(mapper)
    private val mvc = MockMvcBuilders.standaloneSetup(Fixture())
        .setMessageConverters(org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(mapper))
        .setControllerAdvice(ApiExceptionHandler())
        .addFilters<org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder>(RequestIdFilter(writer), JsonBodyFilter(writer)).build()

    @Test
    fun `valid request id survives a safe business error`() {
        val id = "00000000-0000-4000-8000-000000000001"
        val response = mvc.perform(get("/api/v1/_fixture/conflict").header("X-Request-Id", id)).andReturn().response
        assertEquals(409, response.status)
        assertEquals(id, response.getHeader("X-Request-Id"))
        val json = mapper.readTree(response.contentAsByteArray)
        assertEquals(id, json["requestId"].asText())
        assertEquals(setOf("code", "message", "fieldErrors", "requestId"), json.fieldNames().asSequence().toSet())
    }

    @Test
    fun `malformed and duplicate request ids are rejected with a fresh safe id`() {
        for (values in listOf(arrayOf("secret-invalid-id"), arrayOf("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"))) {
            val response = mvc.perform(get("/api/v1/_fixture/conflict").header("X-Request-Id", *values)).andReturn().response
            assertEquals(400, response.status)
            assertEquals(response.getHeader("X-Request-Id"), mapper.readTree(response.contentAsByteArray)["requestId"].asText())
            assertFalse(response.contentAsString.contains("secret-invalid-id"))
        }
    }

    @Test
    fun `json duplicate keys unknown fields and invalid utf8 fail before a success`() {
        for (json in listOf("{\"value\":\"a\",\"value\":\"b\"}", "{\"value\":\"a\",\"secret\":\"do-not-echo\"}")) {
            val response = mvc.perform(post("/api/v1/_fixture/body").contentType(MediaType.APPLICATION_JSON).content(json)).andReturn().response
            assertEquals(400, response.status)
            assertFalse(response.contentAsString.contains("do-not-echo"))
        }
        val invalid = mvc.perform(post("/api/v1/_fixture/body").contentType(MediaType.APPLICATION_JSON).content(byteArrayOf(0xc3.toByte(), 0x28))).andReturn().response
        assertEquals(400, invalid.status)
    }

    @Test
    fun `original bytes are preserved and oversized json is rejected`() {
        val original = "{ \"value\" : \"汉字\" }"
        val accepted = mvc.perform(post("/api/v1/_fixture/body").contentType(MediaType.APPLICATION_JSON).content(original.toByteArray())).andReturn().response
        assertEquals(200, accepted.status)
        assertEquals(original, mapper.readTree(accepted.contentAsByteArray)["raw"].asText())
        val oversized = mvc.perform(post("/api/v1/_fixture/body").contentType(MediaType.APPLICATION_JSON).content(ByteArray(RequestBodies.MAX_JSON_BYTES + 1))).andReturn().response
        assertEquals(413, oversized.status)
    }

    @Test
    fun `unexpected errors do not disclose exception secrets and query type errors are 400`() {
        val failure = mvc.perform(get("/api/v1/_fixture/fail")).andReturn().response
        assertEquals(500, failure.status)
        assertFalse(failure.contentAsString.contains("private-secret"))
        assertEquals(400, mvc.perform(get("/api/v1/_fixture/number").param("number", "wrong")).andReturn().response.status)
    }

    @Test
    fun `instant output is utc milliseconds and required null fields remain present`() {
        val json = mapper.readTree(mapper.writeValueAsBytes(mapOf("time" to Instant.parse("2026-10-26T00:00:00.123456Z"), "value" to null)))
        assertEquals("2026-10-26T00:00:00.123Z", json["time"].asText())
        assertTrue(json.has("value"))
        assertTrue(json["value"].isNull)
    }

    @Test
    fun `local mode and database isolation fail closed`() {
        BackendSafety("local", "127.0.0.1", "jdbc:postgresql://127.0.0.1:56432/qanda_backend", "test-only")
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("local", "0.0.0.0", "jdbc:postgresql://localhost/qanda_backend", "test-only") }
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("production", "127.0.0.1", "jdbc:postgresql://localhost/qanda_sync", "test-only") }
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("production", "127.0.0.1", "jdbc:postgresql://localhost/qanda_backend", "") }
    }

    @Test
    fun `command digest retains raw bytes normalizes metadata and fails on a missing old key`() {
        val digest = CommandDigests(1, mapOf(1 to ByteArray(32) { (it + 1).toByte() }))
        val path = "/api/v1/items/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
        val first = digest.digest("post", path, "application/json;charset=UTF-8", "{\"code\":\"123456\"}".toByteArray())
        assertArrayEquals(java.util.HexFormat.of().parseHex("7c65aa6e213ab63c68545892bd5830393867fabe5969727641ce3ce5270bba63"), first)
        assertArrayEquals(first, digest.digest("POST", path.lowercase(), "application/json", "{\"code\":\"123456\"}".toByteArray()))
        assertFalse(digest.matches(first, digest.digest("POST", path, "application/json", "{ \"code\":\"123456\"}".toByteArray())))
        val missing = assertThrows(ApiException::class.java) { digest.digest("POST", path, "application/json", byteArrayOf(), 2) }
        assertEquals("IDEMPOTENCY_KEY_UNAVAILABLE", missing.code)
        assertEquals(503, missing.status.value())
    }

    data class Payload(val value: String)
    @RestController
    class Fixture {
        @GetMapping("/api/v1/_fixture/conflict")
        fun conflict(): Nothing = throw ApiException(org.springframework.http.HttpStatus.CONFLICT, "VERSION_CONFLICT", "版本已变化")
        @PostMapping("/api/v1/_fixture/body")
        fun body(@RequestBody body: Payload, request: HttpServletRequest) = mapOf("raw" to RequestBodies.bytes(request).toString(Charsets.UTF_8))
        @GetMapping("/api/v1/_fixture/fail")
        fun fail(): Nothing = throw IllegalStateException("private-secret")
        @GetMapping("/api/v1/_fixture/number")
        fun number(@RequestParam number: Int) = number
    }
}
