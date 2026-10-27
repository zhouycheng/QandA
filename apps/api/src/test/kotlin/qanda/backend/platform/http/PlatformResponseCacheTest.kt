package qanda.backend.platform.http

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.Assertions.*
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.content.ContentController
import qanda.backend.content.ContentService
import qanda.backend.content.ContentValidation
import qanda.backend.content.api.ContentView
import qanda.backend.identity.IdentityCrypto
import qanda.backend.platform.files.FileReady
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import javax.imageio.ImageIO

@Tag("platform-acceptance")
@Tag("platform-response-cache")
@ActiveProfiles("platform-rate-limit")
@SpringBootTest(classes = [RequestLimitAcceptanceRuntime::class], webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PlatformResponseCacheTest.ImageResponseFixture::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlatformResponseCacheTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend"); withUsername("platform_cache"); withPassword("isolated-platform-cache"); start() }
        private val subject = UUID.randomUUID()
        private val file = UUID.randomUUID()
        private val image = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 1, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()
        private fun key(value: Int) = Base64.getEncoder().encodeToString(ByteArray(32) { value.toByte() })
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", database::getJdbcUrl); registry.add("spring.datasource.username", database::getUsername); registry.add("spring.datasource.password", database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }; registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }
            registry.add("qanda.backend.mail.enabled") { "false" }; registry.add("qanda.backend.files.enabled") { "false" }; registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:${key(41)}" }; registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:${key(42)}" }; registry.add("BACKEND_IDENTITY_RATE_KEY") { key(43) }
        }
    }
    @TestConfiguration class ImageResponseFixture {
        @Bean fun cacheContentService(): ContentService = mock(ContentService::class.java).also { service ->
            val ready = FileReady(file, "image/png", image.size.toLong(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(image)), 2, 1, Instant.now())
            `when`(service.readImage(subject, file, ContentView.MANAGE, null)).thenReturn(ready to image)
        }
        // Exercise the real controller/cache response; file authorization belongs to Q05's independent suite.
        @Bean fun cacheContentController(service: ContentService, mapper: ObjectMapper) = ContentController(service, ContentValidation(mapper))
    }
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var crypto: IdentityCrypto
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var writer: ErrorWriter
    private lateinit var token: String
    private val evidence = mutableListOf<Map<String, Any>>()

    private fun exchange(method: HttpMethod, path: String, status: Int, body: ByteArray? = null, contentType: String = "application/json", ids: List<String> = listOf(UUID.randomUUID().toString()), authorization: String? = null, cache: String = "no-store"): ResponseEntity<ByteArray> {
        val headers = HttpHeaders().apply { set("Content-Type", contentType); ids.forEach { add("X-Request-Id", it) }; authorization?.let(::setBearerAuth) }
        val response = http.exchange("/api/v1$path", method, HttpEntity(body, headers), ByteArray::class.java)
        assertEquals(status, response.statusCode.value(), "$method $path")
        assertEquals(listOf(cache), response.headers["Cache-Control"])
        assertEquals(1, response.headers["X-Request-Id"]!!.size)
        val requestId = response.headers.getFirst("X-Request-Id")!!
        UUID.fromString(requestId)
        if (status >= 400) {
            val error = mapper.readTree(response.body)
            assertEquals(requestId, error["requestId"].asText())
            assertTrue(error.has("code") && error.has("message") && error["fieldErrors"].isArray)
        }
        evidence += mapOf("method" to method.name(), "path" to path.replace(subject.toString(), "{subjectId}").replace(file.toString(), "{fileId}"), "status" to status, "cacheControl" to response.headers["Cache-Control"]!!, "requestIdCount" to 1)
        return response
    }

    @BeforeAll fun identityFixture() {
        val account = UUID.randomUUID()
        val at = Timestamp.from(Instant.now())
        val password = "Response-cache-fixture-password-123"
        jdbc.update("INSERT INTO identity_account(id,account_code,nickname,status,created_at,updated_at) VALUES (?,'QA0000000041','缓存验收','ACTIVE',?,?)", account, at, at)
        jdbc.update("INSERT INTO identity_email(account_id,email,email_key,verified_at,updated_at) VALUES (?,'cache-fixture@example.test','cache-fixture@example.test',?,?)", account, at, at)
        jdbc.update("INSERT INTO identity_password(account_id,encoded_password,changed_at) VALUES (?,?,?)", account, crypto.preparePassword(password).encoded, at)
        val response = exchange(HttpMethod.POST, "/auth/sessions", 201, mapper.writeValueAsBytes(mapOf("email" to "cache-fixture@example.test", "password" to password, "clientType" to "WEB", "deviceId" to UUID.randomUUID())))
        token = mapper.readTree(response.body)["accessToken"].asText()
    }

    @Test fun `invalid UTF8 errors before authentication have one no-store header for ordinary and Content paths`() {
        for (path in listOf("/admin/colleges", "/subjects")) {
            val response = exchange(HttpMethod.POST, path, 400, byteArrayOf(0xc3.toByte(), 0x28))
            assertEquals("INVALID_REQUEST", mapper.readTree(response.body)["code"].asText())
        }
    }
    @Test fun `malformed and duplicate request ids are rejected before security with one no-store header`() {
        for (ids in listOf(listOf("invalid-id"), listOf(UUID.randomUUID().toString(), UUID.randomUUID().toString()))) {
            val response = exchange(HttpMethod.POST, "/admin/colleges", 400, "{}".toByteArray(), ids = ids)
            assertEquals("INVALID_REQUEST_ID", mapper.readTree(response.body)["code"].asText())
        }
    }
    @Test fun `unsupported JSON charset early rejection has one no-store header`() {
        exchange(HttpMethod.POST, "/admin/colleges", 415, "{}".toByteArray(), "application/json;charset=ISO-8859-1")
    }
    @Test fun `security errors and a normal real directory response retain their single no-store header`() {
        exchange(HttpMethod.POST, "/admin/colleges", 401, "{}".toByteArray())
        exchange(HttpMethod.GET, "/colleges", 200)
    }
    @Test fun `real image controller retains its single private no-store header and exact bytes`() {
        val response = exchange(HttpMethod.GET, "/subjects/$subject/images/$file?view=MANAGE", 200, authorization = token, cache = "private, no-store")
        assertEquals(MediaType.IMAGE_PNG, response.headers.contentType)
        assertEquals(listOf("nosniff"), response.headers["X-Content-Type-Options"])
        assertArrayEquals(image, response.body)
    }
    @Test fun `common error writer replaces an existing cache header without duplication`() {
        val request = MockHttpServletRequest()
        val response = MockHttpServletResponse().apply { setHeader("Cache-Control", "private, no-store") }
        writer.write(request, response, ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请求格式不符合要求"))
        assertEquals(listOf("no-store"), response.getHeaders("Cache-Control").toList())
    }

    @AfterAll fun finish() {
        try {
            val path = Path.of(".backend-runtime/platform-response-cache/http-evidence.json")
            Files.createDirectories(path.parent)
            mapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), mapOf("isolatedMigrationTarget" to "1500", "realQ03SecurityAndDirectory" to true, "imageController" to "real ContentController; explicit test-only read-result stub, no file authorization claim", "realExternalEmails" to 0, "responses" to evidence))
        } finally { database.stop() }
    }
}
