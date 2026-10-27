package qanda.backend.platform.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.autoconfigure.EnableAutoConfiguration
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.ComponentScan
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.FilterType
import org.springframework.context.annotation.Profile
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.identity.IdentityCrypto
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@Configuration
@Profile("platform-rate-limit")
@EnableAutoConfiguration(exclude = [UserDetailsServiceAutoConfiguration::class])
@ComponentScan(basePackages = ["qanda.backend.platform", "qanda.backend.identity", "qanda.backend.authorization", "qanda.backend.adminsecurity"], excludeFilters = [ComponentScan.Filter(type = FilterType.ANNOTATION, classes = [TestConfiguration::class])])
class RequestLimitAcceptanceRuntime

@Tag("platform-acceptance")
@Tag("platform-rate-limit")
@ActiveProfiles("platform-rate-limit")
@SpringBootTest(classes = [RequestLimitAcceptanceRuntime::class], webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class SharedRequestLimitHttpTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend"); withUsername("platform_rate"); withPassword("isolated-platform-rate"); start() }
        private fun key(value: Int) = Base64.getEncoder().encodeToString(ByteArray(32) { value.toByte() })
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", database::getJdbcUrl); registry.add("spring.datasource.username", database::getUsername); registry.add("spring.datasource.password", database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }; registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }
            registry.add("qanda.backend.mail.enabled") { "false" }; registry.add("qanda.backend.files.enabled") { "false" }; registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:${key(31)}" }; registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:${key(32)}" }; registry.add("BACKEND_IDENTITY_RATE_KEY") { key(33) }
            registry.add("qanda.backend.request-limits.window-seconds") { "60" }; registry.add("qanda.backend.request-limits.read-per-account") { "2" }
            registry.add("qanda.backend.request-limits.write-per-account") { "2" }; registry.add("qanda.backend.request-limits.anonymous-per-peer") { "4" }
        }
    }
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var crypto: IdentityCrypto
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    private val accounts = (1..4).map { UUID.randomUUID() }
    private val tokens = mutableMapOf<Int, String>()
    private lateinit var alternate: String
    private lateinit var alternateSession: UUID
    private val evidence = mutableListOf<Map<String, Any>>()
    private val password = "Rate-limit-fixture-password-123"

    private fun call(method: HttpMethod, path: String, expected: Int, token: String? = null, body: Any? = null, extra: Map<String, String> = emptyMap(), key: UUID = UUID.randomUUID()): JsonNode {
        val requestId = UUID.randomUUID().toString()
        val headers = HttpHeaders().apply {
            contentType = MediaType.APPLICATION_JSON; set("X-Request-Id", requestId); set("Idempotency-Key", key.toString())
            token?.let(::setBearerAuth); extra.forEach { (name, value) -> set(name, value) }
        }
        val response = http.exchange("/api/v1$path", method, HttpEntity(body?.let(mapper::writeValueAsString), headers), String::class.java)
        assertEquals(expected, response.statusCode.value(), "$method $path")
        val parsed = mapper.readTree(response.body)
        assertEquals(listOf(requestId), response.headers["X-Request-Id"])
        if (expected == 429) {
            val retry = response.headers["Retry-After"]!!
            assertEquals(1, retry.size); assertTrue(retry.single().matches(Regex("[1-9][0-9]*")))
            assertEquals(parsed["details"]["retryAfterSeconds"].asInt(), retry.single().toInt())
            assertEquals("RATE_LIMITED", parsed["code"].asText()); assertEquals(requestId, parsed["requestId"].asText())
        }
        evidence += mapOf("method" to method.name(), "path" to path, "expectedStatus" to expected, "actualStatus" to response.statusCode.value(), "retryAfterCount" to response.headers["Retry-After"].orEmpty().size)
        return parsed
    }
    private fun login(index: Int): JsonNode = call(HttpMethod.POST, "/auth/sessions", 201, body = mapOf("email" to "rate-fixture-$index@example.test", "password" to password, "clientType" to "ADMIN_WEB", "deviceId" to UUID.randomUUID()))

    @BeforeAll fun fixtures() {
        // Seed only isolated test identities/qualifications; sessions are issued by the real Q03 HTTP login.
        val encoded = crypto.preparePassword(password).encoded
        val at = Timestamp.from(Instant.now())
        tx.required {
            accounts.forEachIndexed { offset, account ->
                val index = offset + 1
                jdbc.update("INSERT INTO identity_account(id,account_code,nickname,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE',?,?)", account, "QA000000000$index", "限流验收$index", at, at)
                val email = "rate-fixture-$index@example.test"
                jdbc.update("INSERT INTO identity_email(account_id,email,email_key,verified_at,updated_at) VALUES (?,?,?,?,?)", account, email, email, at, at)
                jdbc.update("INSERT INTO identity_password(account_id,encoded_password,changed_at) VALUES (?,?,?)", account, encoded, at)
                if (index != 3) jdbc.update("INSERT INTO admin_qualification(account_id,qualified,version,granted_at,created_at,updated_at) VALUES (?,true,1,?,?,?)", account, at, at, at)
            }
            jdbc.update("UPDATE admin_control SET bootstrap_completed_at=? WHERE singleton_id=1", at)
        }
        (1..4).forEach { tokens[it] = login(it)["accessToken"].asText() }
        val second = login(1); alternate = second["accessToken"].asText(); alternateSession = UUID.fromString(second["sessionId"].asText())
    }

    @Test @Order(1) fun `real admin writes throttle before mutation while another legal actor still succeeds`() {
        val created = (1..2).map { call(HttpMethod.POST, "/admin/colleges", 201, tokens[1], mapOf("name" to "限流学院$it")) }
        val colleges = jdbc.queryForObject("SELECT count(*) FROM authz_college", Long::class.java)!!
        val receipts = jdbc.queryForObject("SELECT count(*) FROM authz_command_receipt", Long::class.java)!!
        val audit = jdbc.queryForObject("SELECT count(*) FROM admin_audit_entry", Long::class.java)!!
        call(HttpMethod.PUT, "/admin/colleges/${created.first()["resourceId"].asText()}", 429, tokens[1], mapOf("name" to "应被限流的更名", "status" to "ACTIVE", "expectedVersion" to 1))
        call(HttpMethod.POST, "/admin/colleges", 429, alternate, mapOf("name" to "应被限流的学院"), mapOf("X-Account-Id" to accounts[1].toString(), "X-Forwarded-For" to "203.0.113.10"))
        assertEquals(colleges, jdbc.queryForObject("SELECT count(*) FROM authz_college", Long::class.java))
        assertEquals(receipts, jdbc.queryForObject("SELECT count(*) FROM authz_command_receipt", Long::class.java))
        assertEquals(audit, jdbc.queryForObject("SELECT count(*) FROM admin_audit_entry", Long::class.java))
        call(HttpMethod.POST, "/admin/colleges", 201, tokens[2], mapOf("name" to "另一合法管理员学院"))
    }

    @Test @Order(2) fun `public and protected directories share authenticated account budget across sessions`() {
        call(HttpMethod.GET, "/admin/colleges", 200, tokens[1])
        call(HttpMethod.GET, "/colleges", 200, tokens[1])
        call(HttpMethod.GET, "/admin/colleges", 429, alternate)
        call(HttpMethod.GET, "/colleges?page=2", 429, tokens[1], extra = mapOf("X-Account-Id" to accounts[1].toString()))
        call(HttpMethod.GET, "/colleges", 200, tokens[2])
        call(HttpMethod.GET, "/admin/colleges", 200, tokens[2])
        call(HttpMethod.GET, "/me", 200, tokens[1])
        call(HttpMethod.GET, "/admin/colleges", 403, tokens[3])
        call(HttpMethod.POST, "/admin/colleges", 401, "A".repeat(43), mapOf("name" to "无效身份不可写"))
    }

    @Test @Order(3) fun `anonymous directory traffic ignores spoofed identities and forwarding headers and invalid sessions`() {
        call(HttpMethod.GET, "/colleges", 200)
        call(HttpMethod.GET, "/colleges", 200, extra = mapOf("X-Account-Id" to accounts[1].toString(), "X-Forwarded-For" to "203.0.113.11", "Forwarded" to "for=203.0.113.12"))
        call(HttpMethod.GET, "/colleges", 200, "A".repeat(43))
        jdbc.update("UPDATE identity_auth_session SET revoked_at=clock_timestamp(),revocation_reason='TEST_REVOKED' WHERE id=?", alternateSession)
        call(HttpMethod.GET, "/colleges", 200, alternate)
        call(HttpMethod.GET, "/colleges?page=2", 429, extra = mapOf("X-Forwarded-For" to "203.0.113.13", "Forwarded" to "for=203.0.113.14"))
        call(HttpMethod.GET, "/colleges", 429, "A".repeat(43), extra = mapOf("X-Account-Id" to accounts[0].toString()))
        call(HttpMethod.GET, "/colleges", 200, tokens[3])
    }

    @Test @Order(4) fun `parallel real directory HTTP requests keep the exact account budget`() {
        val pool = Executors.newFixedThreadPool(4)
        val statuses = try {
            pool.invokeAll((1..8).map { Callable {
                val headers = HttpHeaders().apply { setBearerAuth(tokens.getValue(4)) }
                val response = http.exchange("/api/v1/admin/colleges", HttpMethod.GET, HttpEntity<String>(headers), String::class.java)
                if (response.statusCode.value() == 429) {
                    assertEquals(1, response.headers["Retry-After"]!!.size)
                    assertTrue(response.headers.getFirst("Retry-After")!!.matches(Regex("[1-9][0-9]*")))
                }
                response.statusCode.value()
            } }).map { it.get() }
        } finally { pool.shutdownNow() }
        assertEquals(2, statuses.count { it == 200 }); assertEquals(6, statuses.count { it == 429 })
        evidence += mapOf("method" to "GET", "path" to "/admin/colleges", "concurrentRequests" to 8, "accepted" to 2, "limited" to 6)
    }

    @AfterAll fun finish() {
        try {
            val path = Path.of(".backend-runtime/platform-rate-limit/http-evidence.json")
            Files.createDirectories(path.parent)
            mapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), mapOf("isolatedMigrationTarget" to "1500", "realQ03Q04Q12Providers" to true, "testOnlySeededIdentities" to true, "configuredBudgets" to mapOf("windowSeconds" to 60, "readPerAccount" to 2, "writePerAccount" to 2, "anonymousPerPeer" to 4), "realExternalEmails" to 0, "responses" to evidence))
        } finally { database.stop() }
    }
}
