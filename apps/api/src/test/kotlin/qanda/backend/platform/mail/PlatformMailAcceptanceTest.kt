package qanda.backend.platform.mail

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
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
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.ApplicationContext
import org.springframework.context.annotation.ComponentScan
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.FilterType
import org.springframework.context.annotation.Profile
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.containers.wait.strategy.Wait
import qanda.backend.identity.IdentityService
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@Configuration
@Profile("platform-mail-acceptance")
@EnableAutoConfiguration(exclude = [UserDetailsServiceAutoConfiguration::class])
@ComponentScan(basePackages = ["qanda.backend.platform", "qanda.backend.identity", "qanda.backend.authorization", "qanda.backend.adminsecurity"], excludeFilters = [ComponentScan.Filter(type = FilterType.ANNOTATION, classes = [TestConfiguration::class])])
class MailAcceptanceRuntime

@Tag("platform-acceptance")
@Tag("platform-mail")
@ActiveProfiles("platform-mail-acceptance")
@SpringBootTest(classes = [MailAcceptanceRuntime::class], webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class PlatformMailAcceptanceTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend"); withUsername("platform_mail"); withPassword("isolated-platform-mail"); start() }
        private val capture = GenericContainer<Nothing>("axllent/mailpit:v1.32.0").apply { withExposedPorts(1025, 8025); waitingFor(Wait.forHttp("/api/v1/messages").forPort(8025)); start() }
        private fun key(value: Int) = Base64.getEncoder().encodeToString(ByteArray(32) { value.toByte() })
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", database::getJdbcUrl); registry.add("spring.datasource.username", database::getUsername); registry.add("spring.datasource.password", database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "2001" }
            registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }
            registry.add("qanda.backend.mail.enabled") { "true" }; registry.add("qanda.backend.mail.dispatch-enabled") { "false" }
            registry.add("qanda.backend.mail.transport") { "local-capture" }; registry.add("qanda.backend.mail.host") { "127.0.0.1" }; registry.add("qanda.backend.mail.port") { capture.getMappedPort(1025) }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:" + key(11) }; registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:" + key(12) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { key(13) }; registry.add("BACKEND_MAIL_ENCRYPTION_KEYS") { "1:" + key(14) }; registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
        }
    }
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var outbox: JdbcMailOutbox
    @Autowired lateinit var crypto: MailCrypto
    @Autowired lateinit var identity: IdentityService
    @Autowired lateinit var context: ApplicationContext
    @Autowired internal lateinit var transport: IdentityMailTransport
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var http: TestRestTemplate
    @LocalServerPort var port: Int = 0
    private val evidence = linkedMapOf<String, Any>()
    private lateinit var college: UUID
    private lateinit var major: UUID
    private val captureUrl get() = "http://127.0.0.1:${capture.getMappedPort(8025)}"
    private fun dispatcher(box: JdbcMailOutbox = outbox, clock: Clock = Clock.systemUTC()) = MailDispatcher(box, crypto, transport, context.getBeanProvider(IdentityService::class.java), tx, clock)
    private fun futureBox(seconds: Long) = JdbcMailOutbox(jdbc, tx, crypto, Clock.offset(Clock.systemUTC(), Duration.ofSeconds(seconds)))
    private fun recipient() = "platform-${UUID.randomUUID()}@example.test"
    private fun count(sql: String, vararg args: Any?) = jdbc.queryForObject(sql, Long::class.java, *args)!!
    private fun apiJson(path: String): JsonNode {
        val response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI(captureUrl + path)).timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString())
        check(response.statusCode() == 200) { "Local capture API unavailable" }
        return mapper.readTree(response.body())
    }
    private fun capturedCode(email: String): String? {
        for (message in apiJson("/api/v1/messages").path("messages")) {
            if (message.path("To").any { it.path("Address").asText() == email }) {
                val text = apiJson("/api/v1/message/" + message["ID"].asText()).path("Text").asText()
                return Regex("(?<![0-9])([0-9]{6})(?![0-9])").find(text)?.groupValues?.get(1)
            }
        }
        return null
    }

    @Test @Order(1) fun `actual non-web B00 uses captured REGISTER proof and secure console stdin`() {
        val folder = Path.of(".backend-runtime/platform-acceptance/bootstrap")
        Files.createDirectories(folder)
        Files.setPosixFilePermissions(folder, PosixFilePermissions.fromString("rwx------"))
        val config = folder.resolve("input.json")
        val address = recipient()
        val env = mapOf("BACKEND_MODE" to "local", "BACKEND_DB_URL" to database.jdbcUrl, "BACKEND_DB_USER" to database.username, "BACKEND_DB_PASSWORD" to database.password,
            "BACKEND_COMMAND_DIGEST_KEYS" to "1:${key(11)}", "BACKEND_IDENTITY_MAC_KEYS" to "1:${key(12)}", "BACKEND_IDENTITY_RATE_KEY" to key(13), "BACKEND_WECHAT_PROVIDER" to "local",
            "BACKEND_MAIL_ENABLED" to "true", "BACKEND_MAIL_TRANSPORT" to "local-capture", "BACKEND_CAPTURE_SMTP_PORT" to capture.getMappedPort(1025).toString(), "BACKEND_MAIL_ENCRYPTION_KEYS" to "1:${key(14)}",
            "SPRING_FLYWAY_LOCATIONS" to "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity", "SPRING_FLYWAY_TARGET" to "2001")
        Files.writeString(config, mapper.writeValueAsString(mapOf("environment" to env, "java" to Path.of(System.getProperty("java.home"), "bin/java").toString(), "jar" to Path.of("build/libs/qanda-backend-0.1.0.jar").toAbsolutePath().toString(), "api" to "http://127.0.0.1:$port", "capture" to captureUrl, "recipient" to address)))
        Files.setPosixFilePermissions(config, PosixFilePermissions.fromString("rw-------"))
        val process = ProcessBuilder("python3", "scripts/verify-bootstrap-local.py", config.toString()).redirectErrorStream(true).start()
        try {
            val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(100)
            while (process.isAlive && System.nanoTime() < end) { dispatcher().dispatchOne(); Thread.sleep(50) }
            if (process.isAlive) process.destroyForcibly()
            assertTrue(process.waitFor(10, TimeUnit.SECONDS))
            val output = mapper.readTree(process.inputStream.readAllBytes())
            assertEquals(0, process.exitValue(), output.toString())
            assertEquals("PASS", output["status"].asText())
            college = UUID.fromString(output["collegeId"].asText()); major = UUID.fromString(output["majorId"].asText())
            assertEquals(1, count("SELECT count(*) FROM admin_qualification WHERE qualified").toInt())
            assertEquals(0, count("SELECT count(*) FROM authz_membership").toInt())
            assertEquals(1, count("SELECT count(*) FROM identity_email_challenge WHERE email_key=? AND consumed_at IS NOT NULL", address).toInt())
            assertEquals(1, count("SELECT count(*) FROM admin_audit_entry WHERE action='ADMIN_BOOTSTRAPPED'").toInt())
            evidence["bootstrap"] = mapOf("realPty" to true, "secretArguments" to false, "capturedRegisterProof" to true, "realAdminLoginAndCatalog" to true)
        } finally { Files.deleteIfExists(config) }
    }

    @Test @Order(2) fun `captured real email proof creates account membership and matching audit atomically`() {
        val address = recipient()
        val challenge = identity.requestPublicEmailChallenge("REGISTER", address, "platform-mail-test", UUID.randomUUID())
        assertTrue(dispatcher().dispatchOne())
        val code = capturedCode(address) ?: error("Generated proof was not captured by local SMTP")
        val body = mapper.writeValueAsString(mapOf("challengeId" to challenge.challengeId, "code" to code, "password" to "platform-test-password-only", "collegeId" to college, "majorId" to major, "nickname" to "邮件验收学员"))
        val headers = HttpHeaders().apply { contentType = MediaType.APPLICATION_JSON; set("Idempotency-Key", UUID.randomUUID().toString()) }
        val response = http.exchange("http://127.0.0.1:$port/api/v1/auth/email-registrations", HttpMethod.POST, HttpEntity(body, headers), String::class.java)
        assertEquals(201, response.statusCode.value(), "Real registration HTTP must accept the captured proof")
        val result = mapper.readTree(response.body)
        val account = UUID.fromString(result["accountId"].asText())
        assertEquals(1, count("SELECT count(*) FROM authz_membership WHERE account_id=?", account).toInt())
        assertEquals(1, count("SELECT count(*) FROM authz_membership_change c JOIN admin_audit_entry a ON a.event_id=c.change_id WHERE c.account_id=?", account).toInt())
        assertEquals(1, count("SELECT count(*) FROM identity_email_challenge WHERE id=? AND consumed_at IS NOT NULL", challenge.challengeId).toInt())
        assertEquals(0, count("SELECT count(*) FROM mail_delivery WHERE challenge_id=? AND (message_ciphertext IS NOT NULL OR message_nonce IS NOT NULL)", challenge.challengeId).toInt())
        evidence["registration"] = mapOf("httpStatus" to 201, "realQ03Q04Q12" to true, "membershipAuditEventLinked" to true, "materialCleared" to true)
    }

    @Test @Order(3) fun `outbox insert failure rolls back the real identity challenge`() {
        val address = recipient()
        jdbc.execute("CREATE FUNCTION platform_fail_mail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''mail test rollback''; END'")
        jdbc.execute("CREATE TRIGGER platform_fail_mail BEFORE INSERT ON mail_delivery FOR EACH ROW EXECUTE FUNCTION platform_fail_mail()")
        try { assertThrows(ApiException::class.java) { identity.requestPublicEmailChallenge("REGISTER", address, "rollback-test", UUID.randomUUID()) } }
        finally { jdbc.execute("DROP TRIGGER platform_fail_mail ON mail_delivery"); jdbc.execute("DROP FUNCTION platform_fail_mail()") }
        assertEquals(0, count("SELECT count(*) FROM identity_email_challenge WHERE email_key=?", address).toInt())
        evidence["transactionRollback"] = true
    }

    @Test @Order(4) fun `invalidated eligibility cancels without SMTP and expired material keeps foreign-key metadata`() {
        val address = recipient()
        val challenge = identity.requestPublicEmailChallenge("REGISTER", address, "invalidated-test", UUID.randomUUID())
        jdbc.update("UPDATE identity_email_challenge SET invalidated_at=clock_timestamp() WHERE id=?", challenge.challengeId)
        assertTrue(dispatcher().dispatchOne())
        assertEquals("CANCELLED", jdbc.queryForObject("SELECT state FROM mail_delivery WHERE challenge_id=?", String::class.java, challenge.challengeId))
        assertNull(capturedCode(address))
        val expiry = identity.requestPublicEmailChallenge("REGISTER", recipient(), "expiry-test", UUID.randomUUID())
        assertTrue(futureBox(660).sweep() >= 1)
        assertEquals(1, count("SELECT count(*) FROM mail_delivery WHERE challenge_id=? AND state='CANCELLED' AND message_ciphertext IS NULL AND message_nonce IS NULL", expiry.challengeId).toInt())
        assertEquals(1, count("SELECT count(*) FROM identity_email_challenge WHERE id=?", expiry.challengeId).toInt())
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) { jdbc.update("DELETE FROM identity_email_challenge WHERE id=?", expiry.challengeId) }
        evidence["expiryAndEligibility"] = mapOf("noInvalidatedSend" to true, "cipherAndNonceCleared" to true, "metadataFkRetained" to true)
    }

    @Test @Order(5) fun `parallel claims fence expired workers and UNKNOWN never becomes an automatic resend`() {
        repeat(2) { identity.requestPublicEmailChallenge("REGISTER", recipient(), "claim-test", UUID.randomUUID()) }
        val pool = Executors.newFixedThreadPool(2)
        val leases = try { (1..2).map { pool.submit<DeliveryLease?> { outbox.claim() } }.map { it.get(10, TimeUnit.SECONDS)!! } } finally { pool.shutdownNow() }
        assertEquals(2, leases.map { it.id }.toSet().size)
        for (lease in leases) assertFalse(futureBox(31).record(lease, SendResult(SendState.ACCEPTED, "late-without-sweep")))
        assertEquals(2, futureBox(31).sweep())
        for (lease in leases) assertFalse(outbox.record(lease, SendResult(SendState.ACCEPTED, "late-result")))
        assertNull(outbox.claim())
        assertEquals(2, count("SELECT count(*) FROM mail_delivery WHERE state='UNKNOWN'").toInt())
        assertTrue(futureBox(660).sweep() >= 2)
        assertEquals(0, count("SELECT count(*) FROM mail_delivery WHERE state='UNKNOWN' AND message_ciphertext IS NOT NULL").toInt())
        evidence["claimFencingUnknown"] = true
    }

    @Test @Order(6) fun `definite failures retry only within the bounded attempts`() {
        val challenge = identity.requestPublicEmailChallenge("REGISTER", recipient(), "retry-test", UUID.randomUUID())
        val first = outbox.claim()!!; assertTrue(outbox.record(first, SendResult(SendState.RETRYABLE_FAILED, errorCode = "SMTP_CONNECT_FAILED")))
        val secondBox = futureBox(3); val second = secondBox.claim()!!; assertTrue(secondBox.record(second, SendResult(SendState.RETRYABLE_FAILED, errorCode = "SMTP_CONNECT_FAILED")))
        val thirdBox = futureBox(8); val third = thirdBox.claim()!!; assertTrue(thirdBox.record(third, SendResult(SendState.RETRYABLE_FAILED, errorCode = "SMTP_CONNECT_FAILED")))
        val row = jdbc.queryForMap("SELECT state,attempt_count,message_ciphertext,message_nonce FROM mail_delivery WHERE challenge_id=?", challenge.challengeId)
        assertEquals("FAILED", row["state"]); assertEquals(3, (row["attempt_count"] as Number).toInt()); assertNull(row["message_ciphertext"]); assertNull(row["message_nonce"])
        evidence["boundedDefiniteRetries"] = 3
    }

    @Test @Order(7) fun `unexpected transport failure remains UNKNOWN without automatic retry`() {
        val challenge = identity.requestPublicEmailChallenge("REGISTER", recipient(), "unknown-test", UUID.randomUUID())
        val ambiguous = object : IdentityMailTransport {
            override fun send(deliveryId: UUID, material: MailMaterial): SendResult = error("simulated ambiguous provider result")
        }
        val worker = MailDispatcher(outbox, crypto, ambiguous, context.getBeanProvider(IdentityService::class.java), tx, Clock.systemUTC())
        assertTrue(worker.dispatchOne())
        assertEquals("UNKNOWN", jdbc.queryForObject("SELECT state FROM mail_delivery WHERE challenge_id=?", String::class.java, challenge.challengeId))
        assertNull(outbox.claim())
        evidence["unexpectedTransportNoResend"] = true
    }

    @Test @Order(8) fun `real challenge rate limit returns matching Retry-After header and body`() {
        val address = recipient()
        val headers = HttpHeaders().apply { contentType = MediaType.APPLICATION_JSON }
        val request = HttpEntity(mapper.writeValueAsString(mapOf("purpose" to "REGISTER", "email" to address)), headers)
        val url = "http://127.0.0.1:$port/api/v1/auth/email-challenges"
        assertEquals(201, http.postForEntity(url, request, String::class.java).statusCode.value())
        val limited = http.postForEntity(url, request, String::class.java)
        assertEquals(429, limited.statusCode.value())
        val body = mapper.readTree(limited.body)
        assertEquals("RATE_LIMITED", body["code"].asText())
        assertEquals(body["details"]["retryAfterSeconds"].asText(), limited.headers.getFirst("Retry-After"))
        assertTrue(body["details"]["retryAfterSeconds"].asInt() in 1..60)
        evidence["realHttpRateLimit"] = mapOf("status" to 429, "matchingRetryAfter" to true, "businessPolicyOwner" to "Q03")
    }

    @Test @Order(9) fun `actual launcher rejects pipe input before creating a database context`() {
        val process = ProcessBuilder(Path.of(System.getProperty("java.home"), "bin/java").toString(), "-Xmx128m", "-jar", "build/libs/qanda-backend-0.1.0.jar", "bootstrap").redirectErrorStream(true).start()
        process.outputStream.close()
        assertTrue(process.waitFor(15, TimeUnit.SECONDS))
        val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
        assertNotEquals(0, process.exitValue())
        assertTrue(output.contains("首管初始化需要本地交互终端"))
        assertFalse(output.contains("HikariPool"))
        evidence["nonInteractiveBootstrapRejectedBeforeDatabase"] = true
    }

    @AfterAll fun finish() {
        try {
            evidence["realExternalEmails"] = 0
            evidence["isolatedMigrationTarget"] = "2001"
            evidence["mailMetadataRows"] = count("SELECT count(*) FROM mail_delivery")
            val path = Path.of(".backend-runtime/platform-acceptance/mail-evidence.json")
            Files.createDirectories(path.parent); mapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), evidence)
        } finally { capture.stop(); database.stop() }
    }
}
