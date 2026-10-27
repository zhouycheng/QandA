package qanda.backend.identity

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Import
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

@Tag("postgres")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityTestProviders::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class IdentityPostgresTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend"); withUsername("identity_test"); withPassword("isolated-identity-test-password"); start()
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl)
            registry.add("spring.datasource.username",database::getUsername)
            registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity" }
            registry.add("spring.flyway.target") { "1000" }
            registry.add("qanda.backend.mode") { "test" }
            registry.add("server.address") { "127.0.0.1" }
            registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 19 }) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 27 }) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32) { 35 }) }
        }
    }
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var service: IdentityService
    @Autowired lateinit var guards: IdentityGuards
    @Autowired lateinit var crypto: IdentityCrypto
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var clock: IdentityTestClock
    @Autowired lateinit var mail: IdentityTestMail
    @Autowired lateinit var audit: IdentityTestAudit
    @Autowired lateinit var membership: IdentityTestMembership
    @Autowired lateinit var admin: IdentityTestAdmin
    private val password = "Test-password-123😀"
    private fun JsonNode.uuid(field: String) = UUID.fromString(this[field].asText())
    private fun count(table: String) = jdbc.queryForObject("SELECT count(*) FROM $table",Long::class.java)!!
    private fun json(value: Any): String = if (value is String) value else mapper.writeValueAsString(value)
    private fun call(method: HttpMethod, path: String, body: Any? = null, token: String? = null, key: UUID? = null): ResponseEntity<String> {
        val headers = HttpHeaders().apply {
            accept = listOf(MediaType.APPLICATION_JSON)
            if (body != null) contentType = MediaType.APPLICATION_JSON
            if (token != null) setBearerAuth(token)
            if (key != null) set("Idempotency-Key",key.toString())
            set("X-Request-Id",UUID.randomUUID().toString())
        }
        return http.exchange("/api/v1$path",method,HttpEntity(body?.let(::json),headers),String::class.java)
    }
    private fun expect(response: ResponseEntity<String>, status: Int): JsonNode {
        assertEquals(status,response.statusCode.value(),response.body)
        assertEquals("no-store",response.headers.getFirst("Cache-Control"))
        assertNotNull(response.headers.getFirst("X-Request-Id"))
        if (status == 204) { assertTrue(response.body.isNullOrEmpty()); return mapper.nullNode() }
        val body = mapper.readTree(response.body)
        if (status >= 400) {
            assertEquals(response.headers.getFirst("X-Request-Id"),body["requestId"].asText())
            assertTrue(body.has("code") && body.has("message") && body.has("fieldErrors"))
        }
        return body
    }
    private fun challenge(email: String, purpose: String = "REGISTER") = expect(call(HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to purpose,"email" to email)),201)
    private fun emailBody(proof: JsonNode, name: String = "Q友", college: UUID = membership.college): Map<String,Any> = linkedMapOf(
        "challengeId" to proof.uuid("challengeId"),"code" to mail.codes.getValue(proof.uuid("challengeId")),"password" to password,
        "nickname" to name,"collegeId" to college,"majorId" to membership.major)
    private fun register(address: String = "learner@example.com"): JsonNode = expect(call(HttpMethod.POST,"/auth/email-registrations",emailBody(challenge(address)),key=UUID.randomUUID()),201)
    private fun login(address: String = "learner@example.com", raw: String = password): JsonNode = expect(call(HttpMethod.POST,"/auth/sessions",mapOf("email" to address,"password" to raw,"clientType" to "WEB","deviceId" to UUID.randomUUID())),201)
    private fun wx(index: Int = 1): JsonNode = expect(call(HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-$index:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID())),200)
    private fun registerWx(index: Int = 1): JsonNode {
        val ticket = wx(index)
        return expect(call(HttpMethod.POST,"/auth/wechat-registrations",mapOf("registrationToken" to ticket["registrationToken"].asText(),"collegeId" to membership.college,"majorId" to membership.major),key=UUID.randomUUID()),201)
    }
    @BeforeAll fun fixtures() {
        assertTrue(database.jdbcUrl.contains(":${database.firstMappedPort}/qanda_backend"))
        assertEquals(listOf("0001","1000"),jdbc.rows("SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank").map { it.text("version") })
        jdbc.execute("CREATE TABLE identity_test_membership(account_id uuid PRIMARY KEY REFERENCES identity_account(id),college_id uuid NOT NULL,major_id uuid NOT NULL)")
        jdbc.execute("CREATE TABLE identity_test_mail(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES identity_email_challenge(id))")
        jdbc.execute("CREATE TABLE identity_test_audit(id uuid PRIMARY KEY,action text NOT NULL,actor_id uuid REFERENCES identity_account(id))")
        jdbc.execute("CREATE TABLE identity_test_effect(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES identity_account(id))")
    }
    @BeforeEach fun reset() {
        jdbc.execute("TRUNCATE identity_account,identity_email_change,identity_email_challenge,identity_wechat_ticket,identity_rate_bucket CASCADE")
        clock.time.set(Instant.parse("2026-10-26T04:00:55Z")); mail.codes.clear(); mail.fail=false; audit.fail=false; admin.administrators.clear()
    }
    @Test fun `email registration session profile lookup and optional logout match the contract`() {
        val registered = register()
        assertEquals(setOf("accountId","accountCode","version"),registered.fieldNames().asSequence().toSet())
        assertTrue(registered["accountCode"].asText().matches(Regex("QA[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}")))
        val session = login("LEARNER@EXAMPLE.COM")
        val token = session["accessToken"].asText()
        assertEquals(43,token.length)
        assertArrayEquals(crypto.tokenDigest(token),jdbc.row("SELECT token_digest FROM identity_auth_session WHERE id=?",session.uuid("sessionId"))!!.bytes("token_digest"))
        val me = expect(call(HttpMethod.GET,"/me",token=token),200)
        assertFalse(me["adminEligible"].asBoolean())
        assertEquals(setOf("accountId","accountCode","nickname","status","version","createdAt","updatedAt","email","emailVerifiedAt","passwordSet","wechatBound"),me["profile"].fieldNames().asSequence().toSet())
        val key = UUID.randomUUID(); val edit = """{"expectedVersion":1,"nickname":"  新昵称  "}"""
        val changed = expect(call(HttpMethod.PATCH,"/me/profile",edit,token,key),200)
        assertEquals(2,changed["version"].asInt())
        assertEquals(changed,expect(call(HttpMethod.PATCH,"/me/profile",edit,token,key),200))
        assertEquals("IDEMPOTENCY_CONFLICT",expect(call(HttpMethod.PATCH,"/me/profile",edit.replace("新昵称","另一昵称"),token,key),409)["code"].asText())
        assertEquals("VERSION_CONFLICT",expect(call(HttpMethod.PATCH,"/me/profile",edit,token,UUID.randomUUID()),409)["code"].asText())
        val page = expect(call(HttpMethod.GET,"/me/sessions",token=token),200)
        assertEquals(1,page["totalItems"].asInt()); assertTrue(page["items"][0]["current"].asBoolean())
        val empty = expect(call(HttpMethod.GET,"/me/sessions?page=99&pageSize=1",token=token),200)
        assertEquals(1,empty["totalItems"].asInt()); assertTrue(empty["items"].isEmpty)
        val recipient = expect(call(HttpMethod.GET,"/accounts/by-code/${registered["accountCode"].asText()}",token=token),200)
        assertEquals(setOf("accountId","accountCode","nickname"),recipient.fieldNames().asSequence().toSet())
        assertEquals("新昵称",recipient["nickname"].asText())
        expect(call(HttpMethod.DELETE,"/auth/sessions/current",token=token),204)
        expect(call(HttpMethod.DELETE,"/auth/sessions/current",token=token),204)
        expect(call(HttpMethod.DELETE,"/auth/sessions/current"),204)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_test_audit WHERE action='SESSION_REVOKED'",Long::class.java)!!)
    }
    @Test fun `WeChat registration verified email binding password setup and dual email change revoke sessions`() {
        val registered = registerWx()
        assertFalse(registered.has("accessToken"))
        assertEquals(1,count("identity_wechat_ticket")); assertEquals(1,count("identity_test_membership"))
        var session = wx(); var token = session["accessToken"].asText()
        var me = expect(call(HttpMethod.GET,"/me",token=token),200)
        assertTrue(me["profile"]["email"].isNull); assertFalse(me["profile"]["passwordSet"].asBoolean())
        val bind = expect(call(HttpMethod.POST,"/me/email-challenges",mapOf("purpose" to "BIND_EMAIL","email" to "wx@example.com"),token),201)
        expect(call(HttpMethod.PUT,"/me/email-binding",mapOf("challengeId" to bind.uuid("challengeId"),"code" to mail.codes.getValue(bind.uuid("challengeId")),"expectedVersion" to 1),token,UUID.randomUUID()),204)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        session = wx(); token = session["accessToken"].asText()
        val set = expect(call(HttpMethod.POST,"/me/email-challenges",mapOf("purpose" to "CHANGE_PASSWORD"),token),201)
        expect(call(HttpMethod.PUT,"/me/password",mapOf("challengeId" to set.uuid("challengeId"),"code" to mail.codes.getValue(set.uuid("challengeId")),"newPassword" to password,"expectedVersion" to 2),token,UUID.randomUUID()),204)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        token = login("wx@example.com")["accessToken"].asText()
        val changeKey = UUID.randomUUID(); val changeBody = mapOf("newEmail" to "new@example.com","expectedVersion" to 3)
        val change = expect(call(HttpMethod.POST,"/me/email-changes",changeBody,token,changeKey),201)
        assertEquals(change,expect(call(HttpMethod.POST,"/me/email-changes",changeBody,token,changeKey),201))
        val confirm = mapOf("oldCode" to mail.codes.getValue(change.uuid("oldChallengeId")),"newCode" to mail.codes.getValue(change.uuid("newChallengeId")),"expectedVersion" to 3)
        expect(call(HttpMethod.POST,"/me/email-changes/${change["emailChangeId"].asText()}/confirmations",confirm,token,UUID.randomUUID()),204)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        me = expect(call(HttpMethod.GET,"/me",token=login("new@example.com")["accessToken"].asText()),200)
        assertEquals(registered["accountId"],me["profile"]["accountId"])
        assertEquals(4,me["profile"]["version"].asInt())
        assertEquals("new@example.com",me["profile"]["email"].asText())
        assertEquals(1,count("identity_account")); assertEquals(1,count("identity_password"))
    }
    @Test fun `WeChat binding checks receipt before redeeming one use code and rejects ownership collisions`() {
        register(); val token = login()["accessToken"].asText()
        val key = UUID.randomUUID(); val binding = mapOf("code" to "local-learner-2:${UUID.randomUUID()}","expectedVersion" to 1)
        expect(call(HttpMethod.PUT,"/me/wechat-binding",binding,token,key),204)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        val renewed = login()["accessToken"].asText()
        expect(call(HttpMethod.PUT,"/me/wechat-binding",binding,renewed,key),204)
        assertEquals(1,count("identity_wechat"))
        register("other@example.com"); val other = login("other@example.com")["accessToken"].asText()
        val collision = expect(call(HttpMethod.PUT,"/me/wechat-binding",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","expectedVersion" to 1),other,UUID.randomUUID()),409)
        assertEquals("ACCOUNT_LINK_REQUIRED",collision["code"].asText())
        assertEquals(1,count("identity_wechat"))
    }
    @Test fun `reset consumes proof atomically revokes every old session and has a bounded replay window`() {
        register(); val old = login()["accessToken"].asText(); login()
        val proof = challenge("learner@example.com","RESET_PASSWORD")
        val key = UUID.randomUUID(); val body = mapOf("challengeId" to proof.uuid("challengeId"),"code" to mail.codes.getValue(proof.uuid("challengeId")),"newPassword" to "Replacement-password-123")
        expect(call(HttpMethod.POST,"/auth/password-resets",body,key=key),204)
        expect(call(HttpMethod.POST,"/auth/password-resets",body,key=key),204)
        expect(call(HttpMethod.GET,"/me",token=old),401)
        assertEquals(2,jdbc.row("SELECT version FROM identity_account")!!.number("version"))
        login(raw="Replacement-password-123")
        val mismatch = expect(call(HttpMethod.POST,"/auth/password-resets",body+mapOf("newPassword" to "Another-password-123"),key=key),409)
        assertEquals("IDEMPOTENCY_CONFLICT",mismatch["code"].asText())
        clock.advance(86401)
        assertEquals("IDEMPOTENCY_WINDOW_EXPIRED",expect(call(HttpMethod.POST,"/auth/password-resets",body,key=key),409)["code"].asText())
        assertEquals(2,jdbc.row("SELECT version FROM identity_account")!!.number("version"))
    }
    @Test fun `five wrong codes persist across failed requests and correct code cannot revive the proof`() {
        val proof = challenge("bad@example.com"); val original = emailBody(proof)
        val wrong = if (original["code"] == "000000") "111111" else "000000"
        repeat(5) { expect(call(HttpMethod.POST,"/auth/email-registrations",original+mapOf("code" to wrong),key=UUID.randomUUID()),409) }
        assertEquals(5,jdbc.row("SELECT failed_attempts FROM identity_email_challenge WHERE id=?",proof.uuid("challengeId"))!!.number("failed_attempts"))
        expect(call(HttpMethod.POST,"/auth/email-registrations",original,key=UUID.randomUUID()),409)
        assertEquals(0,count("identity_account"))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_test_audit WHERE action='AUTH_RATE_LIMITED'",Long::class.java)!!)
    }
    @Test fun `registration organization mail and audit failures roll back all domain effects`() {
        val proof = challenge("rollback@example.com"); val body = emailBody(proof); val key = UUID.randomUUID()
        expect(call(HttpMethod.POST,"/auth/email-registrations",body+mapOf("collegeId" to UUID.randomUUID()),key=key),409)
        assertEquals(0,count("identity_account")); assertNull(jdbc.row("SELECT consumed_at FROM identity_email_challenge WHERE id=?",proof.uuid("challengeId"))!!["consumed_at"])
        audit.fail = true
        expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=key),503)
        assertEquals(0,count("identity_account")); assertEquals(0,count("identity_test_membership")); assertEquals(0,count("identity_command_receipt"))
        audit.fail = false
        expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=key),201)
        val before = count("identity_email_challenge"); mail.fail = true
        expect(call(HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "mail-fail@example.com")),503)
        assertEquals(before,count("identity_email_challenge"))
    }
    @Test fun `concurrent duplicate registration yields one account membership proof consumption and receipt`() {
        val proof = challenge("race@example.com"); val body = json(emailBody(proof)); val key = UUID.randomUUID()
        val pool = Executors.newFixedThreadPool(2); val start = CountDownLatch(1)
        try {
            val futures = (1..2).map { pool.submit<ResponseEntity<String>> { start.await(); call(HttpMethod.POST,"/auth/email-registrations",body,key=key) } }
            start.countDown()
            val responses = futures.map { expect(it.get(20,TimeUnit.SECONDS),201) }
            assertEquals(responses[0],responses[1])
            assertEquals(1,count("identity_account")); assertEquals(1,count("identity_test_membership")); assertEquals(1,count("identity_command_receipt"))
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_test_audit WHERE action='ACCOUNT_REGISTERED'",Long::class.java)!!)
        } finally { pool.shutdownNow() }
    }
    @Test fun `public challenges conceal existing accounts and cooldown lasts sixty seconds across minute boundary`() {
        register()
        clock.advance(61)
        val before = count("identity_test_mail")
        val decoy = challenge("learner@example.com")
        val absentReset = challenge("missing@example.com","RESET_PASSWORD")
        assertEquals(before,count("identity_test_mail"))
        assertEquals(decoy.fieldNames().asSequence().toSet(),absentReset.fieldNames().asSequence().toSet())
        val first = challenge("cooldown@example.com")
        clock.advance(6)
        val limited = call(HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "cooldown@example.com"))
        expect(limited,429); assertEquals("54",limited.headers.getFirst("Retry-After"))
        clock.advance(54)
        challenge("cooldown@example.com")
        assertTrue(first["nextSendAt"].asText().endsWith("Z"))
    }
    @Test fun `session revocation is owner only and waits for already guarded protected work`() {
        val registered = register(); val session = login(); val token = session["accessToken"].asText()
        val otherSession = login(); val target = otherSession.uuid("sessionId")
        register("foreign@example.com"); val foreign = login("foreign@example.com")
        expect(call(HttpMethod.DELETE,"/me/sessions/${foreign["sessionId"].asText()}",token=token),404)
        expect(call(HttpMethod.DELETE,"/me/sessions/$target",token=token),204)
        expect(call(HttpMethod.DELETE,"/me/sessions/$target",token=token),204)
        val auth = guards.authenticate(token,clock.instant())
        val held = CountDownLatch(1); val release = CountDownLatch(1); val pool = Executors.newFixedThreadPool(2)
        try {
            val protected = pool.submit { tx.required { guards.actor(auth,clock.instant()); held.countDown(); check(release.await(10,TimeUnit.SECONDS)); jdbc.update("INSERT INTO identity_test_effect VALUES (?,?)",UUID.randomUUID(),registered.uuid("accountId")) } }
            assertTrue(held.await(10,TimeUnit.SECONDS))
            val revoke = pool.submit<ResponseEntity<String>> { call(HttpMethod.DELETE,"/me/sessions/${session["sessionId"].asText()}",token=token) }
            assertThrows(TimeoutException::class.java) { revoke.get(200,TimeUnit.MILLISECONDS) }
            release.countDown(); protected.get(10,TimeUnit.SECONDS); expect(revoke.get(10,TimeUnit.SECONDS),204)
            expect(call(HttpMethod.GET,"/me",token=token),401)
            assertThrows(ApiException::class.java) { tx.required { guards.actor(auth,clock.instant()); jdbc.update("INSERT INTO identity_test_effect VALUES (?,?)",UUID.randomUUID(),registered.uuid("accountId")) } }
            assertEquals(1,count("identity_test_effect"))
        } finally { release.countDown(); pool.shutdownNow() }
    }
    @Test fun `disabled targets remain in admin MVCC summaries and reenable does not revive sessions`() {
        val registered = register(); val id = registered.uuid("accountId"); val token = login()["accessToken"].asText()
        val changed = tx.required {
            guards.lockAccountsInTransaction(listOf(AccountLock(id,LockMode.UPDATE)))
            service.setAccountStatus(IdentityTestAdmin.Proof(guards.currentTransactionId()),id,AccountStatus.DISABLED,1,clock.instant())
        }
        assertEquals(2,changed.credentialVersion); assertTrue(changed.changed)
        expect(call(HttpMethod.GET,"/me",token=token),401)
        tx.required {
            val proof = IdentityTestAdmin.Proof(guards.currentTransactionId())
            val page = service.listAccountSummariesForAdministrationInTransaction(proof,AccountFilters(),PageSpec(2,20))
            assertEquals(1,page.totalItems); assertTrue(page.items.isEmpty())
            val summary = service.readAccountSummaries(listOf(id),proof).single()
            assertEquals(AccountStatus.DISABLED,summary.status); assertEquals(2,summary.accountVersion); assertEquals("l***@example.com",summary.maskedEmail)
            assertEquals(registered["accountCode"].asText(),service.readAccountLabels(listOf(id),proof).single().accountCode)
            assertTrue(service.listAccountSummariesForAdministrationInTransaction(proof,AccountFilters(nicknameContains="%_"),PageSpec()).items.isEmpty())
        }
        tx.required {
            guards.lockAccountsInTransaction(listOf(AccountLock(id,LockMode.UPDATE)))
            val result = service.setAccountStatus(IdentityTestAdmin.Proof(guards.currentTransactionId()),id,AccountStatus.ACTIVE,2,clock.instant())
            assertEquals(2,result.credentialVersion)
        }
        expect(call(HttpMethod.GET,"/me",token=token),401)
        login()
        tx.required {
            val guard = guards.lockAccountsInTransaction(listOf(AccountLock(id,LockMode.UPDATE)))[id]
            val result = service.setAccountStatus(IdentityTestAdmin.Proof(guards.currentTransactionId()),id,AccountStatus.ACTIVE,guard.version,clock.instant())
            assertFalse(result.changed); assertTrue(result.auditChanges.isEmpty())
        }
    }
    @Test fun `bootstrap identity uses real REGISTER proof and shares caller rollback without membership or session`() {
        val proof = challenge("bootstrap@example.com"); val id = proof.uuid("challengeId"); val code = mail.codes.getValue(id)
        val prepared = service.prepareLocalBootstrapPassword(password)
        service.preflightBootstrapProof(id,code,UUID.randomUUID())
        assertThrows(IllegalStateException::class.java) {
            tx.required { service.createBootstrapIdentityInTransaction(id,code,prepared,null,clock.instant()); error("caller rollback") }
        }
        assertEquals(0,count("identity_account")); assertNull(jdbc.row("SELECT consumed_at FROM identity_email_challenge WHERE id=?",id)!!["consumed_at"])
        tx.required { service.createBootstrapIdentityInTransaction(id,code,prepared,null,clock.instant()) }
        assertEquals(1,count("identity_account")); assertEquals(1,count("identity_email")); assertEquals(1,count("identity_password"))
        assertEquals(0,count("identity_test_membership")); assertEquals(0,count("identity_auth_session")); assertEquals(0,count("identity_test_audit"))
    }
    @Test fun `mail eligibility closes when consumed expired decoy or security epoch changes`() {
        val initial = challenge("eligible@example.com"); val id = initial.uuid("challengeId")
        fun reason(id: UUID) = tx.required { service.checkIdentityMailEligibilityInTransaction(id,clock.instant()).reasonCode }
        assertEquals("ELIGIBLE",reason(id))
        clock.advance(601); assertEquals("EXPIRED",reason(id)); clock.advance(-601)
        val body = emailBody(initial); expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=UUID.randomUUID()),201)
        assertEquals("CONSUMED",reason(id))
        clock.advance(61); assertEquals("DECOY",reason(challenge("eligible@example.com").uuid("challengeId")))
        val reset = challenge("eligible@example.com","RESET_PASSWORD")
        assertEquals("ELIGIBLE",reason(reset.uuid("challengeId")))
        jdbc.update("UPDATE identity_account SET credential_version=credential_version+1")
        assertEquals("CREDENTIAL_CHANGED",reason(reset.uuid("challengeId")))
        assertEquals("NOT_FOUND",reason(UUID.randomUUID()))
    }
    @Test fun `HTTP rejects unknown fields missing command key invalid tokens and oversized identity JSON`() {
        register(); val token = login()["accessToken"].asText()
        expect(call(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to "x","expectedVersion" to 1),token),400)
        expect(call(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to "x","expectedVersion" to 1,"status" to "DISABLED"),token,UUID.randomUUID()),400)
        expect(call(HttpMethod.POST,"/me/email-challenges","""{"purpose":"CHANGE_PASSWORD","email":null}""",token),422)
        expect(call(HttpMethod.POST,"/auth/sessions",mapOf("email" to "learner@example.com","password" to "x","clientType" to "WEB","deviceId" to UUID.randomUUID())),422)
        expect(call(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to "x".repeat(17000),"expectedVersion" to 1),token,UUID.randomUUID()),413)
        expect(call(HttpMethod.GET,"/me",token="a".repeat(43)),401)
        expect(call(HttpMethod.GET,"/me/sessions?pageSize=101",token=token),422)
        expect(call(HttpMethod.GET,"/me/sessions?email=private@example.com",token=token),422)
        expect(call(HttpMethod.PATCH,"/me/profile","""{"nickname":"x","expectedVersion":1.5}""",token,UUID.randomUUID()),422)
        expect(call(HttpMethod.PATCH,"/me/profile?nickname=other",mapOf("nickname" to "x","expectedVersion" to 1),token,UUID.randomUUID()),400)
        expect(call(HttpMethod.POST,"/auth/sessions","""{"email":"learner@example.com","password":"$password","clientType":"WEB","deviceId":"${UUID.randomUUID()}","rememberMe":"true"}"""),422)
        expect(call(HttpMethod.POST,"/auth/sessions",mapOf("email" to "learner@example.com","password" to password,"clientType" to "WEB","deviceId" to "AAAAAAAAAAAAAAAAAAAAAA")),422)
        assertNotEquals(401,call(HttpMethod.GET,"/colleges").statusCode.value())
    }
    @Test fun `database enforces unique immutable codes and credential relationship constraints`() {
        val registered = register(); val id = registered.uuid("accountId")
        assertThrows(org.springframework.dao.DataAccessException::class.java) { jdbc.update("UPDATE identity_account SET account_code='QA0000000000' WHERE id=?",id) }
        assertThrows(org.springframework.dao.DataAccessException::class.java) { jdbc.update("INSERT INTO identity_password VALUES (?,?,?)",UUID.randomUUID(),"encoded",clock.instant().sql()) }
        assertThrows(org.springframework.dao.DataAccessException::class.java) { jdbc.update("UPDATE identity_auth_session SET token_digest=decode('01','hex')") .also { jdbc.update("INSERT INTO identity_auth_session(id,account_id,token_digest,credential_version,client_type,device_id,issued_at,expires_at,last_seen_at) VALUES (?,?,decode('01','hex'),1,'WEB',?,?,?,?)",UUID.randomUUID(),id,UUID.randomUUID(),clock.instant().sql(),clock.instant().plusSeconds(1).sql(),clock.instant().sql()) } }
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conrelid='identity_email_challenge'::regclass AND contype='f'",Int::class.java)!! >= 2)
    }
    @Test fun `missing receipt digest key fails closed without rerunning the registration`() {
        val proof = challenge("key@example.com"); val body = emailBody(proof); val key = UUID.randomUUID()
        expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=key),201)
        jdbc.update("UPDATE identity_command_receipt SET digest_key_version=2")
        val error = expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=key),503)
        assertEquals("IDEMPOTENCY_KEY_UNAVAILABLE",error["code"].asText()); assertEquals(1,count("identity_account"))
    }
    @Test fun `fifth wrong attempt remains spent when its security audit is unavailable`() {
        val proof = challenge("audit-failure@example.com"); val body = emailBody(proof)
        val wrong = if (body["code"] == "000000") "111111" else "000000"
        repeat(4) { expect(call(HttpMethod.POST,"/auth/email-registrations",body+mapOf("code" to wrong),key=UUID.randomUUID()),409) }
        audit.fail = true
        expect(call(HttpMethod.POST,"/auth/email-registrations",body+mapOf("code" to wrong),key=UUID.randomUUID()),503)
        assertEquals(5,jdbc.row("SELECT failed_attempts FROM identity_email_challenge WHERE id=?",proof.uuid("challengeId"))!!.number("failed_attempts"))
        audit.fail = false
        expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=UUID.randomUUID()),409)
        expect(call(HttpMethod.POST,"/auth/email-registrations",body,key=UUID.randomUUID()),409)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_test_audit WHERE action='AUTH_RATE_LIMITED'",Long::class.java)!!)
    }
    @Test fun `identity guards reject cross transaction reuse reverse order and lock upgrades`() {
        val account = register().uuid("accountId"); val session = login().uuid("sessionId")
        val stale = tx.required { guards.lockAccountsInTransaction(listOf(AccountLock(account)))[account] }
        assertThrows(IllegalStateException::class.java) { tx.required { guards.assertAccountGuard(stale) } }
        assertThrows(IllegalStateException::class.java) { tx.required {
            guards.lockAccountsInTransaction(listOf(AccountLock(account)))
            guards.lockAccountsInTransaction(listOf(AccountLock(account,LockMode.UPDATE)))
        } }
        assertThrows(IllegalStateException::class.java) { tx.required {
            guards.lockAccountsInTransaction(listOf(AccountLock(account)))
            guards.lockSessionsInTransaction(listOf(SessionLock(session)))
            guards.lockAccountsInTransaction(listOf(AccountLock(account)))
        } }
    }
    @Test fun `identity errors and successes return exactly one no store cache header`() {
        val captures = mutableListOf<Map<String,Any?>>()
        fun exchange(operation: String, case: String, method: HttpMethod, path: String, body: Any? = null, bearer: String? = null, key: UUID? = null, status: Int, errorCode: String? = null): JsonNode {
            val response = call(method,path,body,bearer,key)
            val result = mapper.readTree(response.body)
            captures += mapOf("operationId" to operation,"case" to case,"status" to response.statusCode.value(),
                "cacheControlValues" to response.headers[HttpHeaders.CACHE_CONTROL].orEmpty().toList(),
                "retryAfterValues" to response.headers[HttpHeaders.RETRY_AFTER].orEmpty().toList(),
                "errorCode" to if (response.statusCode.isError) result["code"].asText() else null)
            assertEquals(status,response.statusCode.value())
            if (errorCode != null) assertEquals(errorCode,result["code"].asText())
            if (key != null) assertEquals(listOf(key.toString()),response.headers["Idempotency-Key"])
            return result
        }
        try {
            val proof = exchange("identityRequestPublicEmailChallenge","positive",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "headers@example.com"),status=201)
            val registration = emailBody(proof)
            exchange("identityRegisterEmail","positive",HttpMethod.POST,"/auth/email-registrations",registration,key=UUID.randomUUID(),status=201)
            exchange("identityRegisterEmail","consumed-proof-new-command",HttpMethod.POST,"/auth/email-registrations",registration,key=UUID.randomUUID(),status=409,errorCode="VERIFICATION_FAILED")
            val session = exchange("identityCreateEmailSession","positive",HttpMethod.POST,"/auth/sessions",mapOf("email" to "headers@example.com","password" to password,"clientType" to "WEB","deviceId" to UUID.randomUUID()),status=201)
            val bearer = session["accessToken"].asText()
            exchange("identityUpdateProfile","nickname-41-codepoints",HttpMethod.PATCH,"/me/profile",mapOf("expectedVersion" to 1,"nickname" to "🌊".repeat(41)),bearer,UUID.randomUUID(),422,"VALIDATION_FAILED")
            val changed = exchange("identityUpdateProfile","nickname-40-codepoints",HttpMethod.PATCH,"/me/profile",mapOf("expectedVersion" to 1,"nickname" to "🌊".repeat(40)),bearer,UUID.randomUUID(),200)
            assertEquals(2,changed["version"].asInt())
            val auditProof = exchange("identityRequestPublicEmailChallenge","audit-proof",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "headers-audit@example.com"),status=201)
            val auditBody = emailBody(auditProof)
            val auditKey = UUID.randomUUID()
            audit.fail = true
            try {
                exchange("identityRegisterEmail","audit-unavailable",HttpMethod.POST,"/auth/email-registrations",auditBody,key=auditKey,status=503,errorCode="AUDIT_UNAVAILABLE")
            } finally { audit.fail = false }
            assertNull(jdbc.row("SELECT consumed_at FROM identity_email_challenge WHERE id=?",auditProof.uuid("challengeId"))!!["consumed_at"])
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM identity_command_receipt WHERE command_id=?",Long::class.java,auditKey)!!)
            exchange("identityRegisterEmail","same-command-after-rollback",HttpMethod.POST,"/auth/email-registrations",auditBody,key=auditKey,status=201)
            exchange("identityRequestPublicEmailChallenge","cooldown",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "headers@example.com"),status=429,errorCode="RATE_LIMITED")
            assertEquals(listOf("60"),captures.last()["retryAfterValues"])
            for (capture in captures) assertEquals(listOf("no-store"),capture["cacheControlValues"],"${capture["operationId"]}/${capture["case"]}")
        } finally {
            val output = java.nio.file.Path.of(".backend-runtime/verification/identity/error-cache-control-20261026/http-responses.json")
            java.nio.file.Files.createDirectories(output.parent)
            java.nio.file.Files.writeString(output,mapper.writerWithDefaultPrettyPrinter().writeValueAsString(captures))
        }
    }
}
