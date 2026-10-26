package qanda.backend.quality

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.client.TestRestTemplate
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
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.springframework.context.ApplicationContext
import qanda.backend.platform.mail.JdbcMailOutbox
import qanda.backend.platform.mail.MailCrypto
import qanda.backend.platform.mail.MailDispatcher
import qanda.backend.platform.mail.IdentityMailTransport
import qanda.backend.platform.files.BinaryAssetPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.security.MessageDigest
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.*
import java.util.concurrent.*

@Tag("postgres")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class QualityABIntegrationTest {
    companion object {
        private val capture = GenericContainer<Nothing>("axllent/mailpit:v1.32.0").apply { withExposedPorts(1025,8025); waitingFor(Wait.forHttp("/api/v1/messages").forPort(8025)); start() }
        private val assetRoot = Files.createTempDirectory("qanda-quality-ab-assets-")
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend"); withUsername("quality_a");
            withPassword("isolated-quality-only"); start()
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", database::getJdbcUrl)
            registry.add("spring.datasource.username", database::getUsername)
            registry.add("spring.datasource.password", database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity,classpath:db/migration/content" }
            registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }
            registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("qanda.backend.mail.enabled") { "true" }; registry.add("qanda.backend.mail.dispatch-enabled") { "false" }
            registry.add("qanda.backend.mail.transport") { "local-capture" }; registry.add("qanda.backend.mail.host") { "127.0.0.1" }
            registry.add("qanda.backend.mail.port") { capture.getMappedPort(1025) }
            registry.add("BACKEND_MAIL_ENCRYPTION_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 83 }) }
            registry.add("qanda.backend.files.enabled") { "true" }; registry.add("qanda.backend.files.root") { assetRoot.toString() }
            registry.add("qanda.backend.request-limits.anonymous-per-peer") { "3" }
            registry.add("logging.level.root") { "WARN" }

            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:" + Base64.getEncoder().encodeToString(ByteArray(32) { 71 }) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:" + Base64.getEncoder().encodeToString(ByteArray(32) { 73 }) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32) { 79 }) }
        }
    }
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var identity: IdentityService
    @Autowired lateinit var guards: IdentityGuards
    @Autowired lateinit var bootstrap: AdminBootstrapService
    @Autowired lateinit var outbox: JdbcMailOutbox
    @Autowired lateinit var mailCrypto: MailCrypto
    @Autowired internal lateinit var transport: IdentityMailTransport
    @Autowired lateinit var context: ApplicationContext
    @Autowired lateinit var assets: BinaryAssetPort
    @Autowired lateinit var clock: Clock
    private val evidence = Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
    private val checks = mutableListOf<String>()
    private val issues = mutableListOf<Map<String, Any?>>()
    private val headerIssues = Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
    private val password = "Quality-local-password-2026!"
    private lateinit var adminId: UUID
    private lateinit var adminToken: String
    private lateinit var college: UUID
    private lateinit var major: UUID
    private lateinit var otherMajor: UUID
    private lateinit var userId: UUID
    private lateinit var userToken: String
    private val target = Path.of(System.getenv("QANDA_QUALITY_EVIDENCE_DIR") ?: ".backend-runtime/verification/quality/round-02")
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
        validateRequest: Boolean = true, allowMismatch: Boolean = false, allowedStatuses: Set<Int> = setOf(expected), media: String="application/json"): JsonNode {
        val bytes=when(body) { null -> null; is ByteArray -> body; is String -> body.toByteArray(); else -> mapper.writeValueAsBytes(body) }
        val requestId=UUID.randomUUID().toString()
        val headers=HttpHeaders().apply { contentType=MediaType.parseMediaType(media);set("X-Request-Id",requestId);set("Idempotency-Key",key.toString());token?.let(::setBearerAuth) }
        val response=http.exchange("/api/v1$path",method,HttpEntity(bytes,headers),ByteArray::class.java)
        val output=response.body ?: byteArrayOf();val json=response.headers.contentType?.isCompatibleWith(MediaType.APPLICATION_JSON)==true
        val result=if(json && output.isNotEmpty()) mapper.readTree(output) else mapper.nullNode()
        val op=routes.single { it.first==method.name() && it.second.matches("/api/v1"+path.substringBefore('?')) }.third
        evidence.add(mapOf("operationId" to op,"method" to method.name(),"path" to "/api/v1$path","case" to case,
            "requestHeaders" to mapOf("X-Request-Id" to requestId,"Idempotency-Key" to key.toString(),"Content-Type" to media),
            "authenticated" to (token!=null),"requestBody" to (if(bytes!=null && media=="application/json")runCatching { mapper.readTree(bytes) }.getOrNull() else null),
            "requestBinaryBytes" to (if(media!="application/json")bytes?.size else null),"expectedStatus" to expected,"expectedStatuses" to allowedStatuses,
            "status" to response.statusCode.value(),"statusMatches" to (response.statusCode.value() in allowedStatuses),
            "responseHeaders" to response.headers.mapValues { it.value.joinToString(",") },"responseHeaderValues" to response.headers.toMap(),
            "responseBody" to (if(json)result else null),"responseBinaryBytes" to (if(!json)output.size else null),
            "responseBinarySha256" to (if(!json)sha(output) else null),"validateRequest" to validateRequest))
        val cache=if(op in setOf("contentReadImage","contentUploadImage") && response.statusCode.value() in 200..299) "private, no-store" else "no-store"
        for((name,wanted) in listOf("X-Request-Id" to requestId,"Cache-Control" to cache)) {
            if(response.headers[name]!=listOf(wanted)) headerIssues.add(mapOf("owner" to if(op.startsWith("identity")) "identity" else "platform",
                "operationId" to op,"case" to case,"status" to response.statusCode.value(),"header" to name,
                "expected" to listOf(wanted),"actual" to response.headers[name]))
        }
        if(!allowMismatch) assertTrue(response.statusCode.value() in allowedStatuses,"$op/$case status=${response.statusCode.value()} code=${result.path("code").asText()}")
        if(response.statusCode.value()>=400)assertEquals(requestId,result["requestId"].asText())
        return result
    }
    private fun challenge(email: String, purpose: String = "REGISTER") = call(HttpMethod.POST, "/auth/email-challenges",
        mapOf("purpose" to purpose, "email" to email), expected = 201)
    private val capturedProofs = ConcurrentHashMap<UUID,String>()
    private fun code(proof: JsonNode) = capturedByChallenge(proof.id("challengeId"))
    private fun capturedByChallenge(id: UUID): String = capturedProofs.getOrPut(id) {
        val recipient = jdbc.queryForObject("SELECT recipient FROM identity_email_challenge WHERE id=?",String::class.java,id)!!
        val dispatcher = MailDispatcher(outbox,mailCrypto,transport,context.getBeanProvider(IdentityService::class.java),tx,clock)
        fun api(path: String): JsonNode {
            val result=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI("http://127.0.0.1:${capture.getMappedPort(8025)}$path")).timeout(Duration.ofSeconds(3)).GET().build(),HttpResponse.BodyHandlers.ofString())
            check(result.statusCode()==200); return mapper.readTree(result.body())
        }
        var found: String?=null
        repeat(40) {
            if(found==null) {
                dispatcher.dispatchOne()
                val providerId=jdbc.queryForMap("SELECT provider_message_id FROM mail_delivery WHERE challenge_id=?",id)["provider_message_id"]?.toString()?.trim('<','>')
                for(message in api("/api/v1/messages")["messages"].filter { m -> m["To"].any { it["Address"].asText()==recipient } }) {
                    val detail=api("/api/v1/message/"+message["ID"].asText())
                    if(providerId!=null && detail.path("MessageID").asText().trim('<','>')==providerId) {
                        found=Regex("(?<![0-9])([0-9]{6})(?![0-9])").find(detail.path("Text").asText())?.groupValues?.get(1)
                        break
                    }
                }
                if(found==null) Thread.sleep(25)
            }
        }
        found ?: error("Local SMTP did not capture challenge; no external sender is enabled")
    }
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
        assertEquals("qanda_backend",jdbc.queryForObject("SELECT current_database()",String::class.java))
        val required=listOf("mail_delivery_identity_challenge_fk","file_asset_subject_fk","authz_subject_policy_content_fk","content_image_asset_fk")
        val constraints=jdbc.queryForList("SELECT conname FROM pg_constraint WHERE convalidated").map { it["conname"].toString() }
        for(name in required) assertTrue(name in constraints,"Missing validated constraint: $name")
        assertTrue(context.getBean(BinaryAssetPort::class.java).javaClass.name.contains("JdbcBinaryAssets"))
        assertTrue(context.getBean(IdentityMailPort::class.java).javaClass.name.contains("JdbcMailOutbox"))
        checks.add("Full real A+B migrations through2502, including validated mail/file/authorization/content FK; actual BinaryAssetPort")
        val first = challenge("qa-operator@example.test")
        val second = challenge("qa-competitor@example.test")
        code(first); code(second)
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
        val tables = listOf("identity_account", "identity_email", "identity_password", "identity_command_receipt", "authz_membership", "authz_membership_change", "admin_audit_entry", "mail_delivery")
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
        val expiredCode = code(expired)
        jdbc.update("""UPDATE identity_email_challenge SET created_at=now()-interval '20 minutes',
            next_send_at=now()-interval '19 minutes',expires_at=now()-interval '10 minutes' WHERE id=?""", expired.id("challengeId"))
        val accountsBefore = count("identity_account")
        call(HttpMethod.POST, "/auth/email-registrations", mapOf("challengeId" to expired.id("challengeId"), "code" to expiredCode,
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
        call(HttpMethod.POST, "/me/email-changes/${change["emailChangeId"].asText()}/confirmations", mapOf("oldCode" to capturedByChallenge(change.id("oldChallengeId")),
            "newCode" to capturedByChallenge(change.id("newChallengeId")), "expectedVersion" to 3), token, 204)
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

    private lateinit var headerAdminId: UUID
    private lateinit var ownerId: UUID
    private lateinit var ownerToken: String
    private lateinit var viewerId: UUID
    private lateinit var viewerCode: String
    private lateinit var viewerToken: String
    private lateinit var outsiderId: UUID
    private lateinit var outsiderToken: String
    private lateinit var personalSubject: UUID
    private lateinit var personalChapter: UUID
    private lateinit var personalImage: UUID
    private lateinit var personalQuestion: UUID
    private lateinit var personalRevision: UUID
    private fun sha(bytes: ByteArray)=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun doc(text: String="独立验收 🌊\ne\u0301",format: String="PLAIN")=mapOf("blocks" to listOf(mapOf("kind" to "TEXT","text" to text,"format" to format)))
    private fun payload(type: String="TRUE_FALSE",image: UUID?=null): Map<String,Any?> = linkedMapOf<String,Any?>(
        "type" to type,"stem" to if(image==null)doc() else mapOf("blocks" to listOf(mapOf("kind" to "TEXT","text" to "独立图片与公式","format" to "MARKDOWN"),
            mapOf("kind" to "IMAGE","fileId" to image,"alt" to "本地测试图"),mapOf("kind" to "LATEX","source" to "\\frac{1}{2}","display" to true))),"explanation" to doc("独立说明")).apply {
        when(type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> { put("options",listOf("a","b","c").map { mapOf("key" to it,"optionId" to null,"content" to doc(it)) });put("correctOptionKeys",if(type=="SINGLE_CHOICE")listOf("a") else listOf("a","b")) }
            "TRUE_FALSE" -> put("correctValue",true)
            "SHORT_ANSWER" -> put("referenceAnswer",doc("独立参考要点"))
        }
    }
    private fun image(format: String="png"): ByteArray {
        val picture=BufferedImage(3,2,BufferedImage.TYPE_INT_RGB);picture.setRGB(0,0,0x2468ac)
        return ByteArrayOutputStream().also { assertTrue(ImageIO.write(picture,format,it));picture.flush() }.toByteArray()
    }
    private fun subject(token: String,source: String="USER")=call(HttpMethod.POST,"/subjects",mapOf("source" to source,"title" to "独立科目-${UUID.randomUUID().toString().take(8)}","description" to "真实提供端"),token,201).id("subjectId")
    private fun subjectView(s: UUID,token: String)=call(HttpMethod.GET,"/subjects/$s?view=MANAGE",token=token)
    private fun cv(s: UUID,token: String=ownerToken)=subjectView(s,token)["contentVersion"].asLong()
    private fun chapter(s: UUID,token: String)=call(HttpMethod.POST,"/subjects/$s/chapters",mapOf("expectedVersion" to cv(s,token),"title" to "独立章节"),token,201).id("chapterId")
    private fun question(s: UUID,ch: UUID,type: String="TRUE_FALSE",img: UUID?=null,token: String=ownerToken,source: String?=null)=call(HttpMethod.POST,"/subjects/$s/chapters/$ch/questions",mapOf("expectedVersion" to cv(s,token),"question" to mapOf("sourceKey" to source,"content" to payload(type,img))),token,201)
    private fun batch(s: UUID,ch: UUID,questions: List<Any?>)=call(HttpMethod.POST,"/subjects/$s/imports",mapOf("expectedVersion" to cv(s),"documents" to listOf(mapOf("fileName" to "独立样例.json","schemaVersion" to "qanda-content-1","chapterId" to ch,"questions" to questions))),ownerToken,201)
    private fun importItem(key: String,type: String="TRUE_FALSE")=mapOf("sourceKey" to key,"content" to payload(type))

    @Test @Order(0) fun `QA-A-002 all eight admin operations have one request and cache header`() {
        headerAdminId=register("qab-header@example.test").id("accountId")
        call(HttpMethod.GET,"/admin/administrators",token=adminToken)
        call(HttpMethod.GET,"/admin/users",token=adminToken)
        call(HttpMethod.GET,"/admin/users/$headerAdminId",token=adminToken)
        call(HttpMethod.GET,"/admin/security-policy",token=adminToken)
        val entries=call(HttpMethod.GET,"/admin/audit-logs",token=adminToken)
        call(HttpMethod.GET,"/admin/audit-logs/${entries["items"][0]["id"].asText()}",token=adminToken)
        call(HttpMethod.PUT,"/admin/administrators/$headerAdminId/qualification",mapOf("qualified" to true,"expectedVersion" to null),adminToken)
        call(HttpMethod.PUT,"/admin/users/$headerAdminId/status",mapOf("status" to "DISABLED","expectedVersion" to 1),adminToken)
        val adminEvents=evidence.filter { it["operationId"].toString().startsWith("adminSecurity") && (it["status"] as Int) in 200..299 }
        assertEquals(8,adminEvents.map { it["operationId"] }.distinct().size)
        checks.add("QA-A-002: all8 admin success operations have exactly one supplied UUID and one no-store header")
    }

    @Test @Order(6) fun `real content and all12 authorization routes enforce every school grant combination`() {
        ownerToken=login("qa-changed@example.test");ownerId=call(HttpMethod.GET,"/me",token=ownerToken)["profile"].id("accountId")
        val viewer=register("qab-viewer@example.test");viewerId=viewer.id("accountId");viewerCode=viewer["accountCode"].asText();viewerToken=login("qab-viewer@example.test")
        outsiderId=register("qab-outsider@example.test").id("accountId");outsiderToken=login("qab-outsider@example.test")
        val s=subject(adminToken,"SCHOOL");val ch=chapter(s,adminToken);val q=question(s,ch,token=adminToken).id("questionId")
        call(HttpMethod.GET,"/subjects/$s",token=viewerToken,expected=404)
        call(HttpMethod.GET,"/subjects/$s?view=MANAGE",token=viewerToken,expected=403)
        var policy=call(HttpMethod.GET,"/admin/subjects/$s/school-access",token=adminToken)["version"].asLong()
        call(HttpMethod.GET,"/admin/subjects/$s/college-grants",token=adminToken)
        call(HttpMethod.GET,"/admin/subjects/$s/major-grants",token=adminToken)
        call(HttpMethod.GET,"/admin/subjects/$s/account-rules",token=adminToken)
        // Gray-code order changes one business input per case using real HTTP commands.
        var previous=0
        for(i in 0 until 32) {
            val bits=i xor (i shr 1);val changed=previous xor bits
            val p=(bits and 1)!=0;val g=(bits and 2)!=0;val c=(bits and 4)!=0;val m=(bits and 8)!=0;val b=(bits and 16)!=0
            val actor=if(i%2==0)adminToken else userToken
            if(i>0) {
                val result=when(changed) {
                    1 -> call(HttpMethod.PUT,"/admin/subjects/$s/school-access",mapOf("isPublic" to p,"expectedVersion" to policy),actor)
                    2,16 -> call(HttpMethod.PUT,"/admin/subjects/$s/account-rules/$viewerId",mapOf("granted" to g,"inheritanceBlocked" to b,"expectedVersion" to policy),actor)
                    4 -> call(HttpMethod.PUT,"/admin/subjects/$s/college-grants/$college",mapOf("enabled" to c,"expectedVersion" to policy),actor)
                    8 -> call(HttpMethod.PUT,"/admin/subjects/$s/major-grants/$major",mapOf("enabled" to m,"expectedVersion" to policy),actor)
                    else -> error("Invalid Gray-code transition")
                }
                policy=result["version"].asLong()
            }
            val allowed=p || g || ((c || m) && !b)
            val explanation=call(HttpMethod.GET,"/admin/accounts/$viewerId/school-access",token=actor)["items"].single { it["subjectId"].asText()==s.toString() }
            assertEquals(allowed,explanation["accessGranted"].asBoolean(),"School formula case $bits")
            call(HttpMethod.GET,"/subjects/$s/questions/$q",token=viewerToken,expected=if(allowed)200 else 404,case="school-access-$bits")
            previous=bits
        }
        personalSubject=subject(ownerToken);personalChapter=chapter(personalSubject,ownerToken)
        call(HttpMethod.GET,"/subjects/$personalSubject?view=MANAGE",token=adminToken,expected=404)
        call(HttpMethod.GET,"/subjects/$personalSubject",token=outsiderToken,expected=404)
        call(HttpMethod.GET,"/subjects/$personalSubject/shares",token=ownerToken)
        call(HttpMethod.POST,"/subjects/$personalSubject/shares",mapOf("accountCode" to viewerCode,"expectedVersion" to 1),ownerToken,200)
        question(personalSubject,personalChapter,source="future-after-share")
        assertTrue(call(HttpMethod.GET,"/subjects/$personalSubject/chapters/$personalChapter/questions",token=viewerToken)["totalItems"].asInt()>0)
        call(HttpMethod.GET,"/subjects/$personalSubject?view=MANAGE",token=viewerToken,expected=404)
        call(HttpMethod.POST,"/subjects/$personalSubject/share-revocations",mapOf("recipientAccountId" to viewerId,"expectedVersion" to 2),ownerToken,200)
        call(HttpMethod.GET,"/subjects/$personalSubject",token=viewerToken,expected=404)
        checks.add("Real12 content authorization routes and32 P/G/C/M/block combinations; USER future additions and revoke enforced")
    }

    @Test @Order(7) fun `all23 content operations preserve four types revisions and real binary ownership`() {
        val s=personalSubject;val ch=personalChapter
        call(HttpMethod.PUT,"/subjects/$s",mapOf("expectedVersion" to subjectView(s,ownerToken)["version"].asLong(),"title" to "独立修订科目","description" to "本地真实链路"),ownerToken)
        val ch2=chapter(s,ownerToken)
        call(HttpMethod.PUT,"/subjects/$s/chapters/$ch",mapOf("expectedVersion" to 1,"title" to "独立章修订","status" to "ACTIVE"),ownerToken)
        call(HttpMethod.PUT,"/subjects/$s/chapter-order",mapOf("expectedVersion" to cv(s),"ids" to listOf(ch2,ch)),ownerToken)
        assertEquals(ch2.toString(),call(HttpMethod.GET,"/subjects/$s/chapters?view=MANAGE",token=ownerToken)["items"][0]["id"].asText())
        val uploadKey=UUID.randomUUID();val png=image()
        val uploaded=call(HttpMethod.POST,"/subjects/$s/images",png,ownerToken,201,key=uploadKey,media="image/png")
        assertEquals(uploaded,call(HttpMethod.POST,"/subjects/$s/images",png,ownerToken,201,key=uploadKey,media="image/png"))
        call(HttpMethod.POST,"/subjects/$s/images",png+byteArrayOf(1),ownerToken,409,key=uploadKey,media="image/png")
        personalImage=uploaded.id("fileId")
        val created=listOf("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER").map { question(s,ch,it,personalImage,source="independent-$it") }
        personalQuestion=created[2].id("questionId")
        val original=call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion",token=ownerToken);personalRevision=original.id("revisionId")
        val revised=call(HttpMethod.PUT,"/subjects/$s/questions/$personalQuestion",mapOf("expectedVersion" to 1,"content" to payload()+mapOf("correctValue" to false)),ownerToken)
        assertEquals(original["payload"],call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion/revisions/$personalRevision",token=ownerToken)["payload"])
        assertNotEquals(original["revisionId"],revised["revisionId"])
        call(HttpMethod.GET,"/subjects/$s/images/$personalImage?view=MANAGE&revisionId=$personalRevision",token=ownerToken)
        assertEquals(jdbc.queryForObject("SELECT sha256 FROM file_asset WHERE id=?",String::class.java,personalImage),evidence.last()["responseBinarySha256"])
        call(HttpMethod.PUT,"/subjects/$s/questions/$personalQuestion/status",mapOf("expectedVersion" to 2,"status" to "INACTIVE"),ownerToken)
        call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion",token=ownerToken,expected=404)
        call(HttpMethod.PUT,"/subjects/$s/questions/$personalQuestion/status",mapOf("expectedVersion" to 3,"status" to "ACTIVE"),ownerToken)
        val questions=call(HttpMethod.GET,"/subjects/$s/chapters/$ch/questions?view=MANAGE",token=ownerToken)["items"].map { it.id("id") }
        call(HttpMethod.PUT,"/subjects/$s/chapters/$ch/question-order",mapOf("expectedVersion" to cv(s),"ids" to questions.reversed()),ownerToken)
        call(HttpMethod.GET,"/subjects/$s/question-search?q=独立",token=ownerToken)
        val valid=batch(s,ch2,listOf(importItem("independent-import","SHORT_ANSWER")))
        assertEquals("VALID",valid["state"].asText())
        call(HttpMethod.GET,"/subjects/$s/imports/${valid.id("id")}",token=ownerToken)
        call(HttpMethod.POST,"/subjects/$s/imports/${valid.id("id")}/commit",mapOf("expectedVersion" to 1),ownerToken,200)
        val cancel=batch(s,ch2,listOf(importItem("independent-cancel")))
        call(HttpMethod.POST,"/subjects/$s/imports/${cancel.id("id")}/cancel",mapOf("expectedVersion" to 1),ownerToken,200)
        call(HttpMethod.PUT,"/subjects/$s/status",mapOf("expectedVersion" to subjectView(s,ownerToken)["version"].asLong(),"status" to "INACTIVE"),ownerToken)
        call(HttpMethod.GET,"/subjects/$s",token=ownerToken,expected=409)
        call(HttpMethod.PUT,"/subjects/$s/status",mapOf("expectedVersion" to subjectView(s,ownerToken)["version"].asLong(),"status" to "ACTIVE"),ownerToken)
        call(HttpMethod.GET,"/subjects?view=MANAGE&source=USER",token=ownerToken)
        assertEquals(23,evidence.filter { it["operationId"].toString().startsWith("content") && (it["status"] as Int) in 200..299 }.map { it["operationId"] }.distinct().size)
        checks.add("All23 Content operations real success; four types, retained immutable revisions, ordering and valid/cancelled import")
    }

    @Test @Order(8) fun `import fault retries sorting CAS and composite file FK never leave partial facts`() {
        val s=personalSubject;val ch=personalChapter
        val duplicate=batch(s,ch,listOf(importItem("independent-TRUE_FALSE")))
        assertEquals("INVALID",duplicate["state"].asText())
        call(HttpMethod.POST,"/subjects/$s/imports/${duplicate.id("id")}/commit",mapOf("expectedVersion" to 1),ownerToken,422)
        val ready=batch(s,ch,listOf(importItem("atomic-left"),importItem("atomic-right","SHORT_ANSWER")))
        val tables=listOf("content_question","content_question_revision","content_revision_attachment","content_command_receipt","admin_audit_entry")
        val snapshot=tables.associateWith(::count);val key=UUID.randomUUID();val raw="{\"expectedVersion\":1}"
        jdbc.execute("CREATE FUNCTION quality_content_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CONTENT_IMPORT_COMMITTED' THEN RAISE EXCEPTION 'quality import fault'; END IF; RETURN NEW; END $$")
        jdbc.execute("CREATE TRIGGER quality_content_audit_fault BEFORE INSERT ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION quality_content_audit_fault()")
        try {
            call(HttpMethod.POST,"/subjects/$s/imports/${ready.id("id")}/commit",raw,ownerToken,503,key=key)
            assertEquals(snapshot,tables.associateWith(::count))
            assertEquals("VALID",call(HttpMethod.GET,"/subjects/$s/imports/${ready.id("id")}",token=ownerToken)["state"].asText())
        } finally { jdbc.execute("DROP TRIGGER quality_content_audit_fault ON admin_audit_entry");jdbc.execute("DROP FUNCTION quality_content_audit_fault()") }
        val committed=call(HttpMethod.POST,"/subjects/$s/imports/${ready.id("id")}/commit",raw,ownerToken,200,key=key)
        assertEquals(committed,call(HttpMethod.POST,"/subjects/$s/imports/${ready.id("id")}/commit",raw,ownerToken,200,key=key))
        call(HttpMethod.POST,"/subjects/$s/imports/${ready.id("id")}/commit","{\"expectedVersion\":2}",ownerToken,409,key=key)
        chapter(s,ownerToken)
        val ids=call(HttpMethod.GET,"/subjects/$s/chapters?view=MANAGE",token=ownerToken)["items"].map { it.id("id") };val version=cv(s)
        assertTrue(ids.size>=3)
        val orders=listOf(ids.drop(1)+ids.take(1),ids.drop(2)+ids.take(2))
        val pool=Executors.newFixedThreadPool(2)
        try {
            val barrier=CyclicBarrier(2)
            val outcomes=orders.map { order -> pool.submit(Callable {
                barrier.await(5,TimeUnit.SECONDS)
                call(HttpMethod.PUT,"/subjects/$s/chapter-order",mapOf("expectedVersion" to version,"ids" to order),ownerToken,allowedStatuses=setOf(200,409),case="concurrent-content-sort")
            }) }.map { it.get(15,TimeUnit.SECONDS) }
            assertEquals(1,outcomes.count { it.has("code") });assertEquals(version+1,cv(s))
        } finally { pool.shutdownNow() }
        val another=subject(ownerToken)
        val unreferenced=call(HttpMethod.POST,"/subjects/$s/images",image(),ownerToken,201,media="image/png").id("fileId")
        val failure=assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("UPDATE content_image SET subject_id=? WHERE file_id=?",another,unreferenced) }
        var cause: Throwable=failure;while(cause.cause!=null)cause=cause.cause!!
        assertTrue(cause.message.orEmpty().contains("content_image_asset_fk"))
        call(HttpMethod.GET,"/subjects/$another/images/$unreferenced?view=MANAGE",token=ownerToken,expected=404)
        val userNull=assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO content_subject(id,source,owner_account_id,title,description,status,version,content_version,created_by,created_at,updated_at) VALUES (?,'USER',NULL,'SQL owner check','fixture','ACTIVE',1,1,?,now(),now())",UUID.randomUUID(),ownerId) }
        var sqlCause: Throwable=userNull;while(sqlCause.cause!=null)sqlCause=sqlCause.cause!!
        assertEquals("23514",(sqlCause as java.sql.SQLException).sqlState)
        val school=UUID.randomUUID()
        assertThrows(ProbeRollback::class.java) { tx.required {
            jdbc.update("INSERT INTO content_subject(id,source,owner_account_id,title,description,status,version,content_version,created_by,created_at,updated_at) VALUES (?,'SCHOOL',NULL,'SQL school owner','fixture','ACTIVE',1,1,?,now(),now())",school,adminId)
            assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM content_subject WHERE id=? AND owner_account_id IS NULL",Long::class.java,school))
            throw ProbeRollback()
        } }
        assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM content_subject WHERE id=?",Long::class.java,school))
        checks.add("Import L80 fault full rollback/exact retry/different-body409; sort CAS single winner; real cross-subject file composite FK; USER null owner CHECK23514, SCHOOL null owner allowed then rolled back")
    }

    @Test @Order(9) fun `real image formats and fresh sharing permission protect every byte read`() {
        val s=personalSubject;val ch=personalChapter
        val webp=Base64.getDecoder().decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQrVJUsP+BiOh/AAA=")
        for((mime,bytes) in listOf("image/png" to image(),"image/jpeg" to image("jpeg"),"image/webp" to webp)) {
            val uploaded=call(HttpMethod.POST,"/subjects/$s/images",bytes,ownerToken,201,media=mime)
            val file=uploaded.id("fileId");val question=question(s,ch,img=file)
            call(HttpMethod.GET,"/subjects/$s/images/$file?revisionId=${question.id("revisionId")}",token=ownerToken)
            assertEquals(uploaded["sizeBytes"].asLong(),(evidence.last()["responseBinaryBytes"] as Int).toLong())
            assertEquals(jdbc.queryForObject("SELECT sha256 FROM file_asset WHERE id=?",String::class.java,file),evidence.last()["responseBinarySha256"])
        }
        val beforeOversize=cv(s)
        call(HttpMethod.POST,"/subjects/$s/images",ByteArray(5242881),ownerToken,413,media="image/png",case="image-limit-plus-one-structured413")
        assertEquals(beforeOversize,cv(s))
        call(HttpMethod.POST,"/subjects/$s/images","not an image".toByteArray(),ownerToken,415,media="image/png")
        call(HttpMethod.GET,"/subjects/$s/images/$personalImage?view=MANAGE",token=adminToken,expected=404)
        call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion",token=outsiderToken,expected=404)
        val revision=call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion",token=ownerToken).id("revisionId")
        val version=call(HttpMethod.GET,"/subjects/$s/shares",token=ownerToken)["version"].asLong()
        call(HttpMethod.POST,"/subjects/$s/shares",mapOf("accountCode" to viewerCode,"expectedVersion" to version),ownerToken,200)
        val imageQuestion=question(s,ch,img=personalImage)
        call(HttpMethod.GET,"/subjects/$s/images/$personalImage?revisionId=${imageQuestion.id("revisionId")}",token=viewerToken)
        call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion/revisions/$revision",token=viewerToken,expected=404)
        call(HttpMethod.POST,"/subjects/$s/share-revocations",mapOf("recipientAccountId" to viewerId,"expectedVersion" to version+1),ownerToken,200)
        call(HttpMethod.GET,"/subjects/$s/images/$personalImage?revisionId=${imageQuestion.id("revisionId")}",token=viewerToken,expected=404)
        call(HttpMethod.GET,"/subjects/$s/questions/$personalQuestion",token=viewerToken,expected=404)
        val proof=challenge("qab-unsent-expiry@example.test")
        val pending=jdbc.queryForObject("SELECT id FROM mail_delivery WHERE challenge_id=?",UUID::class.java,proof.id("challengeId"))!!
        JdbcMailOutbox(jdbc,tx,mailCrypto,Clock.offset(clock,Duration.ofHours(1))).sweep()
        val cleared=jdbc.queryForMap("SELECT message_ciphertext,message_nonce FROM mail_delivery WHERE id=?",pending)
        assertTrue(cleared["message_ciphertext"]==null && cleared["message_nonce"]==null)
        assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM mail_delivery m JOIN identity_email_challenge c ON c.id=m.challenge_id WHERE m.id=?",Long::class.java,pending))
        checks.add("Real PNG/JPEG/WebP+SHA bytes, outside-transaction provider open, immediate revoke/private-body rejection, retained mail FK with expired ciphertext cleared")
    }

    @Test @Order(10) fun `generic directory and mutation rate limits produce real429 with no extra effects`() {
        call(HttpMethod.GET,"/colleges",case="generic-read-budget-last-success")
        val denial=call(HttpMethod.GET,"/colleges",expected=429,case="generic-directory429")
        fun retryMatches(value: JsonNode) {
            val hdr=(evidence.last()["responseHeaders"] as Map<*,*>).entries.single { it.key.toString().equals("Retry-After",true) }.value.toString().toInt()
            assertEquals(hdr,value["details"]["retryAfterSeconds"].asInt());assertTrue(hdr>0)
        }
        retryMatches(denial)
        call(HttpMethod.GET,"/colleges",token=ownerToken,case="valid-account-after-anonymous-limit")
        call(HttpMethod.PUT,"/admin/users/$headerAdminId/status",mapOf("status" to "ACTIVE","expectedVersion" to version(headerAdminId)),adminToken)
        val actor=login("qab-header@example.test","ADMIN_WEB");val key=UUID.randomUUID();val raw="{\"status\":\"ACTIVE\",\"expectedVersion\":1}"
        repeat(120) { call(HttpMethod.PUT,"/admin/users/$outsiderId/status",raw,actor,key=key,case="generic-write-budget") }
        retryMatches(call(HttpMethod.PUT,"/admin/users/$outsiderId/status",raw,actor,429,key=key,case="generic-mutation429"))
        assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM admin_command_receipt WHERE actor_account_id=?",Long::class.java,headerAdminId))
        assertEquals(1L,version(outsiderId))
        checks.add("Generic directory429 at configured anonymous budget3, and mutation429 at real default120/account; Retry-After matches details; replay remains one receipt/no status mutation")
    }

    @Test @Order(11) fun `nickname Unicode code-point length40 succeeds and41 rejects without effects`() {
        val nickname="🌊".repeat(40)
        assertEquals(40,nickname.codePointCount(0,nickname.length));assertEquals(80,nickname.length)
        call(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to nickname,"expectedVersion" to version(ownerId)),ownerToken,case="unicode40-codepoints")
        assertEquals(40,jdbc.queryForObject("SELECT char_length(nickname) FROM identity_account WHERE id=?",Int::class.java,ownerId))
        val before=version(ownerId)
        call(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to nickname+"🌊","expectedVersion" to before),ownerToken,422,validateRequest=false,case="unicode41-codepoints")
        assertEquals(before,version(ownerId))
        checks.add("Nickname max40 Unicode codepoints (80 UTF16 units): HTTP+SQL boundary;41 rejected without version mutation")
    }

    private class ProbeRollback: RuntimeException()
    @Test @Order(12) fun `one invalid UTF8 body gets a full early error and cache header`() {
        val bytes="{\"nickname\":\"".toByteArray()+byteArrayOf(0xc3.toByte(),0x28)+"\"}".toByteArray()
        call(HttpMethod.PATCH,"/me/profile",bytes,expected=400,validateRequest=false,case="invalid-utf8-before-security")
        checks.add("Invalid UTF8 rejected before identity with complete trace/cache/error response")
    }

    private fun redact(value: JsonNode, key: String = ""): JsonNode {
        if (key.lowercase() in setOf("password", "newpassword", "accesstoken", "registrationtoken", "oldcode", "newcode") ||
            key == "code" && value.isTextual && !value.asText().matches(Regex("[A-Z][A-Z0-9_]+"))) return mapper.nodeFactory.textNode("[REDACTED]")
        if (value.isObject) return mapper.createObjectNode().also { out -> value.fields().forEach { (name, child) -> out.set<JsonNode>(name, redact(child, name)) } }
        if (value.isArray) return mapper.createArrayNode().also { out -> value.forEach { out.add(redact(it)) } }
        return value
    }

    @AfterAll fun preserveIndependentEvidence() {
        val raw = evidence.toList()
        val process = ProcessBuilder(Path.of(".backend-runtime/verification/quality/tools/python/bin/python").toAbsolutePath().toString(),
            "acceptance/contracts.py", "exchanges").redirectErrorStream(true).start()
        process.outputStream.use { mapper.writeValue(it, raw) }
        val validation = process.inputStream.bufferedReader().readText()
        val exit = process.waitFor()
        Files.writeString(target.resolve("a-http-schema-validation.json"), validation)
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("a-http-redacted.json").toFile(), redact(mapper.valueToTree(raw)))
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("a-assertions.json").toFile(), mapOf(
            "database" to "isolated Testcontainers PostgreSQL17.6/qanda_backend", "scope" to "AB76","migrationVersions" to jdbc.queryForList("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank",String::class.java),
            "providers" to "real identity/authorization/admin/content/file/outbox/SMTP Mailpit; explicit local WeChat; vendor0",
            "checks" to checks, "findings" to (issues+headerIssues), "exchanges" to raw.size,
            "operationIds" to raw.map { it["operationId"] }.distinct(), "schemaExitCode" to exit,"mailTransport" to "REAL_LOCAL_CAPTURE","vendorCalls" to 0))
        Files.walk(assetRoot).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        assertEquals(0, exit, "Mature response-schema validation failed; see independent redacted evidence")
        assertTrue(headerIssues.isEmpty(), "Full response header assertions failed; see a-assertions.json")
    }
}
