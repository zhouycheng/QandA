package qanda.backend.quality

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.DataAccessException
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.adminsecurity.AdminBootstrapService
import qanda.backend.adminsecurity.api.LocalOperatorProof
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.IdentityService
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.mail.IdentityMailPort
import qanda.backend.platform.mail.PreparedMailEnvelope
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.*
import java.util.concurrent.*

/** Real A providers and isolated PostgreSQL; only outgoing mail is explicitly test-only. */
class QualityLocalMail(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions) : IdentityMailPort {
    val codes = ConcurrentHashMap<UUID, String>()
    override fun prepareIdentityMailEnvelope(challengeId: UUID, recipient: String, code: String,
        templateCode: String, templateVersion: Int, expiresAt: Instant): PreparedMailEnvelope {
        codes[challengeId] = code
        return PreparedMailEnvelope(challengeId, templateCode, templateVersion, expiresAt, "test-only", "test-only", 1)
    }
    override fun enqueueIdentityMailInTransaction(challengeId: UUID, expiresAt: Instant,
        encryptedMessageRef: PreparedMailEnvelope, requestId: UUID): UUID = tx.mandatory {
        UUID.randomUUID().also { jdbc.update("INSERT INTO quality_test_mail VALUES (?,?)", it, challengeId) }
    }
}

@Tag("postgres")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(QualityAIntegrationTest.LocalMailConfiguration::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class QualityAIntegrationTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend"); withUsername("quality_a");
            withPassword("isolated-quality-only"); start()
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", database::getJdbcUrl)
            registry.add("spring.datasource.username", database::getUsername)
            registry.add("spring.datasource.password", database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }
            registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }
            registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:" + Base64.getEncoder().encodeToString(ByteArray(32) { 71 }) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:" + Base64.getEncoder().encodeToString(ByteArray(32) { 73 }) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32) { 79 }) }
        }
    }
    @TestConfiguration class LocalMailConfiguration {
        @Bean @Primary fun qualityLocalMail(jdbc: JdbcTemplate, tx: JdbcTransactions) = QualityLocalMail(jdbc, tx)
    }
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var identity: IdentityService
    @Autowired lateinit var guards: IdentityGuards
    @Autowired lateinit var bootstrap: AdminBootstrapService
    @Autowired lateinit var mail: QualityLocalMail
    @Autowired lateinit var clock: Clock
    private val evidence = Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
    private val checks = mutableListOf<String>()
    private val issues = mutableListOf<Map<String, Any?>>()
    private val password = "Quality-local-password-2026!"
    private lateinit var adminId: UUID
    private lateinit var adminToken: String
    private lateinit var college: UUID
    private lateinit var major: UUID
    private lateinit var otherMajor: UUID
    private lateinit var userId: UUID
    private lateinit var userToken: String
    private val target = Path.of(System.getenv("QANDA_QUALITY_EVIDENCE_DIR") ?: ".backend-runtime/verification/quality").resolve("a-only")
    private val routes by lazy {
        listOf("identity", "authorization", "admin-security", "content", "practice", "learning", "analytics")
            .flatMap { owner ->
                val doc = mapper.readTree(Path.of("contracts/modules/$owner/openapi.yaml").toFile())
                doc["paths"].fields().asSequence().flatMap { (path, item) ->
                    item.fields().asSequence().filter { it.key in setOf("get", "post", "put", "patch", "delete") }
                        .map { (method, op) -> Triple(method.uppercase(),
                            Regex("/api/v1" + path.replace(Regex("\\{[^}]+}"), "[^/]+")), op["operationId"].asText()) }
                }.toList()
            }
    }
    private fun JsonNode.id(field: String) = UUID.fromString(this[field].asText())
    private fun count(table: String) = jdbc.queryForObject("SELECT count(*) FROM $table", Long::class.java)!!
    private fun version(id: UUID) = jdbc.queryForObject("SELECT version FROM identity_account WHERE id=?", Long::class.java, id)!!
    private fun qualificationVersion(id: UUID) = jdbc.queryForObject("SELECT COALESCE((SELECT version FROM admin_qualification WHERE account_id=?),0)", Long::class.java, id)!!
    private fun activeAdmins() = jdbc.queryForObject("SELECT count(*) FROM admin_qualification q JOIN identity_account a ON a.id=q.account_id WHERE q.qualified AND a.status='ACTIVE'", Long::class.java)!!
    private fun call(method: HttpMethod, path: String, body: Any? = null, token: String? = null,
        expected: Int = 200, key: UUID = UUID.randomUUID(), case: String = "positive",
        validateRequest: Boolean = true, allowMismatch: Boolean = false, allowedStatuses: Set<Int> = setOf(expected)): JsonNode {
        val raw = body?.let { if (it is String) it else mapper.writeValueAsString(it) }
        val requestId = UUID.randomUUID().toString()
        val headers = HttpHeaders().apply {
            contentType = MediaType.APPLICATION_JSON; set("X-Request-Id", requestId)
            set("Idempotency-Key", key.toString()); token?.let(::setBearerAuth)
        }
        val response = http.exchange("/api/v1$path", method, HttpEntity(raw, headers), String::class.java)
        val result = response.body?.takeIf { it.isNotEmpty() }?.let(mapper::readTree) ?: mapper.nullNode()
        val op = routes.single { it.first == method.name() && it.second.matches("/api/v1" + path.substringBefore('?')) }.third
        evidence.add(mapOf("operationId" to op, "method" to method.name(), "path" to "/api/v1$path",
            "case" to case, "requestHeaders" to mapOf("X-Request-Id" to requestId, "Idempotency-Key" to key.toString(), "Content-Type" to "application/json"),
            "authenticated" to (token != null), "requestBody" to raw?.let(mapper::readTree),
            "expectedStatus" to expected, "expectedStatuses" to allowedStatuses, "status" to response.statusCode.value(), "statusMatches" to (response.statusCode.value() in allowedStatuses),
            "responseHeaders" to response.headers.entries.associate { it.key to it.value.joinToString(",") },
            "responseBody" to (if (result.isNull) null else result), "validateRequest" to validateRequest))
        assertEquals(requestId, response.headers.getFirst("X-Request-Id"), "$op requestId")
        assertEquals("no-store", response.headers.getFirst("Cache-Control"), "$op cache")
        if (!allowMismatch) assertTrue(response.statusCode.value() in allowedStatuses, "$op/$case status=${response.statusCode.value()} code=${result.path("code").asText()}")
        if (response.statusCode.value() >= 400) assertEquals(requestId, result["requestId"].asText())
        return result
    }
    private fun challenge(email: String, purpose: String = "REGISTER") = call(HttpMethod.POST, "/auth/email-challenges",
        mapOf("purpose" to purpose, "email" to email), expected = 201)
    private fun code(proof: JsonNode) = mail.codes.getValue(proof.id("challengeId"))
    private fun login(email: String, client: String = "WEB") = call(HttpMethod.POST, "/auth/sessions",
        mapOf("email" to email, "password" to password, "clientType" to client, "deviceId" to UUID.randomUUID()), expected = 201)["accessToken"].asText()
    private fun wx(identity: String) = call(HttpMethod.POST, "/auth/wechat-sessions",
        mapOf("code" to "$identity:${UUID.randomUUID()}", "clientType" to "MINI_PROGRAM", "deviceId" to UUID.randomUUID()))
    private fun register(email: String): JsonNode {
        val proof = challenge(email)
        return call(HttpMethod.POST, "/auth/email-registrations", mapOf("challengeId" to proof.id("challengeId"),
            "code" to code(proof), "password" to password, "collegeId" to college, "majorId" to major), expected = 201)
    }

    @BeforeAll fun initialize() {
        Files.createDirectories(target)
        jdbc.execute("CREATE TABLE quality_test_mail(id uuid PRIMARY KEY, challenge_id uuid NOT NULL REFERENCES identity_email_challenge(id))")
        val first = challenge("qa-operator@example.test")
        val second = challenge("qa-competitor@example.test")
        val prepared = identity.prepareLocalBootstrapPassword(password)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val barrier = CyclicBarrier(2)
            val results = listOf(first, second).map { proof -> executor.submit(Callable {
                barrier.await(5, TimeUnit.SECONDS)
                runCatching { bootstrap.bootstrap(proof.id("challengeId"), code(proof), prepared, "质量管理员",
                    LocalOperatorProof("BOOTSTRAP", UUID.randomUUID()), UUID.randomUUID()) }
            }) }.map { it.get(15, TimeUnit.SECONDS) }
            val winner = results.single { it.isSuccess }.getOrThrow()
            assertEquals("BOOTSTRAP_CLOSED", (results.single { it.isFailure }.exceptionOrNull() as ApiException).code)
            adminId = winner.accountId
            val email = jdbc.queryForObject("SELECT email FROM identity_email WHERE account_id=?", String::class.java, adminId)
            adminToken = login(email!!, "ADMIN_WEB")
        } finally { executor.shutdownNow() }
        assertEquals(1L, activeAdmins()); assertEquals(0L, count("authz_membership"))
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM admin_audit_entry WHERE action='ADMIN_BOOTSTRAPPED'", Long::class.java))
        college = call(HttpMethod.POST, "/admin/colleges", mapOf("name" to "验收学院"), adminToken, 201).id("resourceId")
        major = call(HttpMethod.POST, "/admin/colleges/$college/majors", mapOf("name" to "验收专业甲"), adminToken, 201).id("resourceId")
        otherMajor = call(HttpMethod.POST, "/admin/colleges/$college/majors", mapOf("name" to "验收专业乙"), adminToken, 201).id("resourceId")
        checks.add("Concurrent B00: exactly one admin/account/audit and no membership/token issued by bootstrap")
    }

    @Test @Order(1) fun `registration idempotency stable audit and real rollback`() {
        val proof = challenge("qa-user@example.test")
        val body = mapper.writeValueAsString(mapOf("challengeId" to proof.id("challengeId"), "code" to code(proof),
            "password" to password, "collegeId" to college, "majorId" to major))
        val key = UUID.randomUUID(); val pool = Executors.newFixedThreadPool(2)
        try {
            val barrier = CyclicBarrier(2)
            val responses = (1..2).map { pool.submit(Callable { barrier.await(5, TimeUnit.SECONDS)
                call(HttpMethod.POST, "/auth/email-registrations", body, expected = 201, key = key, case = "concurrent-same-command")
            }) }.map { it.get(20, TimeUnit.SECONDS) }
            assertEquals(responses[0], responses[1]); userId = responses[0].id("accountId")
        } finally { pool.shutdownNow() }
        userToken = login("qa-user@example.test")
        call(HttpMethod.POST, "/auth/email-registrations", body, expected = 409, case = "consumed-proof-new-command", allowedStatuses = setOf(409, 422))
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM identity_command_receipt WHERE command_id=?", Long::class.java, key))
        assertEquals(0L, jdbc.queryForObject("""SELECT count(*) FROM authz_membership_change h WHERE
            (SELECT count(*) FROM admin_audit_entry a WHERE a.source_module='AUTHORIZATION' AND a.action='MEMBERSHIP_CHANGED' AND a.event_id=h.change_id)<>1""", Long::class.java))
        val retryProof = challenge("qa-retry@example.test")
        val retry = mapOf("challengeId" to retryProof.id("challengeId"), "code" to code(retryProof), "password" to password,
            "collegeId" to college, "majorId" to major)
        val retryKey = UUID.randomUUID()
        val tables = listOf("identity_account", "identity_email", "identity_password", "identity_command_receipt", "authz_membership", "authz_membership_change", "admin_audit_entry", "quality_test_mail")
        val before = tables.associateWith(::count)
        jdbc.execute("""CREATE FUNCTION quality_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.source_module='AUTHORIZATION' AND NEW.action='MEMBERSHIP_CHANGED' THEN RAISE EXCEPTION 'quality fault'; END IF; RETURN NEW; END $$""")
        jdbc.execute("CREATE TRIGGER quality_audit_failure BEFORE INSERT ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION quality_audit_failure()")
        try {
            assertEquals("AUDIT_UNAVAILABLE", call(HttpMethod.POST, "/auth/email-registrations", retry,
                expected = 503, key = retryKey, case = "membership-audit-fault")["code"].asText())
            assertEquals(before, tables.associateWith(::count))
            assertTrue(jdbc.queryForMap("SELECT consumed_at FROM identity_email_challenge WHERE id=?", retryProof.id("challengeId"))["consumed_at"] == null)
        } finally {
            jdbc.execute("DROP TRIGGER quality_audit_failure ON admin_audit_entry"); jdbc.execute("DROP FUNCTION quality_audit_failure()")
        }
        call(HttpMethod.POST, "/auth/email-registrations", retry, expected = 201, key = retryKey, case = "same-request-after-rollback")
        val expired = challenge("qa-expired@example.test")
        jdbc.update("""UPDATE identity_email_challenge SET created_at=now()-interval '20 minutes',
            next_send_at=now()-interval '19 minutes',expires_at=now()-interval '10 minutes' WHERE id=?""", expired.id("challengeId"))
        val accountsBefore = count("identity_account")
        call(HttpMethod.POST, "/auth/email-registrations", mapOf("challengeId" to expired.id("challengeId"), "code" to code(expired),
            "password" to password, "collegeId" to college, "majorId" to major), expected = 409, case = "expired-email-proof", allowedStatuses = setOf(409, 422))
        assertEquals(accountsBefore, count("identity_account"))
        checks.add("Registration race/idempotency + stable membership event join + real L80 fault rollback and same-byte retry")
    }

    @Test @Order(2) fun `A directories membership administration boundaries and constraints`() {
        call(HttpMethod.GET, "/colleges")
        call(HttpMethod.GET, "/colleges/$college/majors")
        call(HttpMethod.GET, "/admin/colleges", token = adminToken)
        call(HttpMethod.GET, "/admin/colleges/$college", token = adminToken)
        call(HttpMethod.PUT, "/admin/colleges/$college", mapOf("name" to "验收学院修订", "status" to "ACTIVE", "expectedVersion" to 1), adminToken)
        call(HttpMethod.GET, "/admin/colleges/$college/majors", token = adminToken)
        call(HttpMethod.GET, "/admin/majors/$major", token = adminToken)
        call(HttpMethod.PUT, "/admin/majors/$major", mapOf("name" to "验收专业修订", "status" to "ACTIVE", "expectedVersion" to 1), adminToken)
        call(HttpMethod.GET, "/me/membership", token = userToken)
        call(HttpMethod.PUT, "/me/membership", mapOf("collegeId" to college, "majorId" to otherMajor, "expectedVersion" to 1), userToken)
        call(HttpMethod.GET, "/admin/accounts/$userId/membership", token = adminToken)
        call(HttpMethod.PUT, "/admin/accounts/$userId/membership", mapOf("collegeId" to college, "majorId" to major, "expectedVersion" to 2), adminToken)
        call(HttpMethod.GET, "/admin/accounts/$userId/membership-history", token = adminToken)
        val existing = call(HttpMethod.GET, "/admin/users/$adminId", token = userToken, expected = 403)
        val missing = call(HttpMethod.GET, "/admin/users/${UUID.randomUUID()}", token = userToken, expected = 403)
        assertEquals(existing["code"], missing["code"])
        call(HttpMethod.GET, "/admin/users", expected = 401)
        call(HttpMethod.GET, "/admin/administrators", token = adminToken)
        call(HttpMethod.GET, "/admin/users?nicknameContains=%E9%AA%8C", token = adminToken)
        val student = call(HttpMethod.GET, "/admin/users/$userId", token = adminToken)
        assertFalse(student.has("password") || student.has("answer") || student.has("token"))
        call(HttpMethod.GET, "/admin/security-policy", token = adminToken)
        val audit = call(HttpMethod.GET, "/admin/audit-logs", token = adminToken)
        call(HttpMethod.GET, "/admin/audit-logs/${audit["items"][0]["id"].asText()}", token = adminToken)
        val recipient = call(HttpMethod.GET, "/accounts/by-code/${student["accountCode"].asText()}", token = adminToken)
        assertEquals(setOf("accountId", "accountCode", "nickname"), recipient.fieldNames().asSequence().toSet())
        call(HttpMethod.PATCH, "/me/profile", mapOf("nickname" to "验收学习者", "expectedVersion" to version(userId)), userToken)
        val codeBefore = jdbc.queryForObject("SELECT account_code FROM identity_account WHERE id=?", String::class.java, userId)
        assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("UPDATE authz_membership SET major_id=? WHERE account_id=?", UUID.randomUUID(), userId) }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE identity_account SET account_code=? WHERE id=?", "QA0000000000", userId) }
        assertEquals(codeBefore, jdbc.queryForObject("SELECT account_code FROM identity_account WHERE id=?", String::class.java, userId))
        assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO identity_email SELECT * FROM identity_email WHERE account_id=?", userId) }
        val subject = UUID.randomUUID()
        call(HttpMethod.GET, "/admin/accounts/$userId/school-access", token = adminToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.GET, "/admin/subjects/$subject/school-access", token = adminToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.PUT, "/admin/subjects/$subject/school-access", mapOf("isPublic" to true, "expectedVersion" to 1), adminToken, 503, case = "pending-content-fk")
        call(HttpMethod.GET, "/admin/subjects/$subject/college-grants", token = adminToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.PUT, "/admin/subjects/$subject/college-grants/$college", mapOf("enabled" to true, "expectedVersion" to 1), adminToken, 503, case = "pending-content-fk")
        call(HttpMethod.GET, "/admin/subjects/$subject/major-grants", token = adminToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.PUT, "/admin/subjects/$subject/major-grants/$major", mapOf("enabled" to true, "expectedVersion" to 1), adminToken, 503, case = "pending-content-fk")
        call(HttpMethod.GET, "/admin/subjects/$subject/account-rules", token = adminToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.PUT, "/admin/subjects/$subject/account-rules/$userId", mapOf("granted" to true, "inheritanceBlocked" to false, "expectedVersion" to 1), adminToken, 503, case = "pending-content-fk")
        call(HttpMethod.GET, "/subjects/$subject/shares", token = userToken, expected = 503, case = "pending-content-fk")
        call(HttpMethod.POST, "/subjects/$subject/shares", mapOf("accountCode" to codeBefore, "expectedVersion" to 1), userToken, 503, case = "pending-content-fk")
        call(HttpMethod.POST, "/subjects/$subject/share-revocations", mapOf("recipientAccountId" to userId, "expectedVersion" to 1), userToken, 503, case = "pending-content-fk")
        checks.add("15 directory/membership operations, admin8 reads, least disclosure, real membership FK and immutable accountCode")
    }

    @Test @Order(3) fun `identity credential changes optional email and session invalidation`() {
        val ticket = wx("local-learner-1")
        val registration = call(HttpMethod.POST, "/auth/wechat-registrations", mapOf("registrationToken" to ticket["registrationToken"].asText(),
            "collegeId" to college, "majorId" to major), expected = 201)
        var token = wx("local-learner-1")["accessToken"].asText()
        assertTrue(call(HttpMethod.GET, "/me", token = token)["profile"]["email"].isNull)
        val proof = call(HttpMethod.POST, "/me/email-challenges", mapOf("purpose" to "BIND_EMAIL", "email" to "qa-wechat@example.test"), token, 201)
        call(HttpMethod.PUT, "/me/email-binding", mapOf("challengeId" to proof.id("challengeId"), "code" to code(proof), "expectedVersion" to 1), token, 204)
        call(HttpMethod.GET, "/me", token = token, expected = 401)
        token = wx("local-learner-1")["accessToken"].asText()
        val passwordProof = call(HttpMethod.POST, "/me/email-challenges", mapOf("purpose" to "CHANGE_PASSWORD"), token, 201)
        call(HttpMethod.PUT, "/me/password", mapOf("challengeId" to passwordProof.id("challengeId"), "code" to code(passwordProof),
            "newPassword" to password, "expectedVersion" to 2), token, 204)
        token = login("qa-wechat@example.test")
        val change = call(HttpMethod.POST, "/me/email-changes", mapOf("newEmail" to "qa-changed@example.test", "expectedVersion" to 3), token, 201)
        call(HttpMethod.POST, "/me/email-changes/${change["emailChangeId"].asText()}/confirmations", mapOf("oldCode" to mail.codes.getValue(change.id("oldChallengeId")),
            "newCode" to mail.codes.getValue(change.id("newChallengeId")), "expectedVersion" to 3), token, 204)
        call(HttpMethod.GET, "/me", token = token, expected = 401)
        token = login("qa-changed@example.test")
        call(HttpMethod.DELETE, "/auth/sessions/current", token = token, expected = 204)
        call(HttpMethod.DELETE, "/auth/sessions/current", token = token, expected = 204)
        call(HttpMethod.GET, "/me", token = token, expected = 401)
        call(HttpMethod.PUT, "/me/wechat-binding", mapOf("code" to "local-learner-2:${UUID.randomUUID()}", "expectedVersion" to version(userId)), userToken, 204)
        userToken = login("qa-user@example.test")
        val reset = challenge("qa-user@example.test", "RESET_PASSWORD")
        call(HttpMethod.POST, "/auth/password-resets", mapOf("challengeId" to reset.id("challengeId"), "code" to code(reset), "newPassword" to password), expected = 204)
        call(HttpMethod.GET, "/me", token = userToken, expected = 401)
        userToken = login("qa-user@example.test")
        val session = call(HttpMethod.GET, "/me/sessions", token = userToken)["items"].first { it["current"].asBoolean() }
        call(HttpMethod.DELETE, "/me/sessions/${session["sessionId"].asText()}", token = userToken, expected = 204)
        call(HttpMethod.GET, "/me", token = userToken, expected = 401)
        userToken = login("qa-user@example.test")
        val expiryToken = login("qa-user@example.test")
        val expiring = guards.authenticate(expiryToken, clock.instant())
        jdbc.update("UPDATE identity_auth_session SET expires_at=issued_at+interval '1 millisecond' WHERE id=?", expiring.sessionId)
        call(HttpMethod.GET, "/me", token = expiryToken, expected = 401, case = "expired-session")
        assertEquals(registration["accountId"], wx("local-learner-1")["accountId"])
        checks.add("18 identity operations, explicit local WeChat without email, credential revocation, logout replay, own-session revocation and expired bearer")
    }

    @Test @Order(4) fun `last active admin concurrent self disable and old sessions remain revoked`() {
        call(HttpMethod.PUT, "/admin/administrators/$userId/qualification", mapOf("qualified" to true, "expectedVersion" to null), adminToken)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val barrier = CyclicBarrier(2)
            val tokens = listOf(adminId to adminToken, userId to userToken)
            val futures = tokens.map { (id, token) -> pool.submit(Callable {
                barrier.await(5, TimeUnit.SECONDS)
                call(HttpMethod.PUT, "/admin/users/$id/status", mapOf("status" to "DISABLED", "expectedVersion" to version(id)), token,
                    expected = 200, case = "last-admin-race", allowedStatuses = setOf(200, 409))
            }) }
            val results = futures.map { it.get(15, TimeUnit.SECONDS) }
            assertEquals(1, results.count { it.path("code").asText() == "LAST_ADMIN_REQUIRED" })
            assertEquals(1L, activeAdmins())
            val survivor = jdbc.queryForObject("SELECT a.id FROM identity_account a JOIN admin_qualification q ON q.account_id=a.id WHERE a.status='ACTIVE' AND q.qualified", UUID::class.java)!!
            val disabled = if (survivor == adminId) userId else adminId
            val survivorToken = tokens.single { it.first == survivor }.second
            val oldToken = tokens.single { it.first == disabled }.second
            call(HttpMethod.PUT, "/admin/users/$disabled/status", mapOf("status" to "ACTIVE", "expectedVersion" to version(disabled)), survivorToken)
            call(HttpMethod.GET, "/me", token = oldToken, expected = 401)
            val operatorEmail = jdbc.queryForObject("SELECT email FROM identity_email WHERE account_id=?", String::class.java, adminId)!!
            adminToken = login(operatorEmail, "ADMIN_WEB"); userToken = login("qa-user@example.test")
        } finally { pool.shutdownNow() }
        checks.add("Two simultaneous admin self-disables: one success, one LAST_ADMIN_REQUIRED, one active admin; re-enable does not revive old token")
    }

    @Test @Order(5) fun `strict JSON types are independently probed at HTTP trust boundary`() {
        fun probe(owner: String, path: String, method: HttpMethod, raw: String, token: String, keyword: String) {
            val before = evidence.size
            call(method, path, raw, token, expected = 422, case = "wrong-json-$keyword", validateRequest = false, allowMismatch = true)
            val event = evidence[before]
            val rejected = event["status"] in listOf(400, 422)
            evidence[before] = event + mapOf("expectedStatuses" to listOf(400, 422), "statusMatches" to rejected)
            if (!rejected) issues.add(mapOf("owner" to owner, "operationId" to event["operationId"], "case" to event["case"],
                "expectedStatuses" to listOf(400, 422), "actualStatus" to event["status"], "trigger" to mapper.readTree(raw)))
        }
        probe("Q03", "/me/profile", HttpMethod.PATCH, """{"nickname":123,"expectedVersion":${version(userId)}}""", userToken, "numeric-nickname")
        for ((kind, wrong) in listOf("string" to "\"2\"", "boolean" to "true", "array" to "[2]", "fraction" to "2.5")) {
            probe("Q04", "/admin/colleges/$college", HttpMethod.PUT,
                """{"name":"验收学院修订","status":"ACTIVE","expectedVersion":$wrong}""", adminToken, "$kind-version")
        }
        for ((kind, wrong) in listOf("string" to "\"true\"", "number" to "1", "array" to "[true]")) {
            probe("Q12", "/admin/administrators/$userId/qualification", HttpMethod.PUT,
                """{"qualified":$wrong,"expectedVersion":${qualificationVersion(userId)}}""", adminToken, "$kind-boolean")
        }
        val v = qualificationVersion(userId)
        for ((kind, wrong) in listOf("string" to "\"$v\"", "boolean" to "true", "array" to "[$v]", "fraction" to "$v.5")) {
            probe("Q12", "/admin/administrators/$userId/qualification", HttpMethod.PUT,
                """{"qualified":true,"expectedVersion":$wrong}""", adminToken, "$kind-version")
        }
        probe("Q12", "/admin/administrators/$userId/qualification", HttpMethod.PUT,
            """{"qualified":true,"expectedVersion":$v,"unexpected":true}""", adminToken, "unknown-field")
        checks.add("Wrong JSON types checked with valid auth/CAS context; successful coercions are recorded as defects")
        assertTrue(issues.isEmpty(), "Wrong JSON types accepted: ${issues.map { it["operationId"].toString()+":"+it["case"] }}")
    }

    private fun redact(value: JsonNode, key: String = ""): JsonNode {
        if (key.lowercase() in setOf("password", "newpassword", "accesstoken", "registrationtoken", "oldcode", "newcode") ||
            key == "code" && value.isTextual && !value.asText().matches(Regex("[A-Z][A-Z0-9_]+"))) return mapper.nodeFactory.textNode("[REDACTED]")
        if (value.isObject) return mapper.createObjectNode().also { out -> value.fields().forEach { (name, child) -> out.set<JsonNode>(name, redact(child, name)) } }
        if (value.isArray) return mapper.createArrayNode().also { out -> value.forEach { out.add(redact(it)) } }
        return value
    }

    @AfterAll fun preserveIndependentEvidence() {
        Files.createDirectories(target)
        val raw = evidence.toList()
        val process = ProcessBuilder(Path.of(".backend-runtime/verification/quality/tools/python/bin/python").toAbsolutePath().toString(),
            "acceptance/contracts.py", "exchanges").redirectErrorStream(true).start()
        process.outputStream.use { mapper.writeValue(it, raw) }
        val validation = process.inputStream.bufferedReader().readText()
        val exit = process.waitFor()
        Files.writeString(target.resolve("a-http-schema-validation.json"), validation)
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("a-http-redacted.json").toFile(), redact(mapper.valueToTree(raw)))
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("a-assertions.json").toFile(), mapOf(
            "database" to "isolated Testcontainers PostgreSQL17.6/qanda_backend", "migrationsThrough" to 1500,
            "providers" to "real identity/authorization/admin; explicit test-only local mail and WeChat",
            "checks" to checks, "findings" to issues, "exchanges" to raw.size,
            "operationIds" to raw.map { it["operationId"] }.distinct(), "schemaExitCode" to exit))
        assertEquals(0, exit, "Mature response-schema validation failed; see independent redacted evidence")
    }
}
