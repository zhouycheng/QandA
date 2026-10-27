package qanda.backend.identity

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.adminsecurity.AdminBootstrapService
import qanda.backend.adminsecurity.api.LocalOperatorProof
import qanda.backend.identity.api.ClientType
import qanda.backend.platform.transaction.JdbcTransactions
import java.util.Base64
import java.util.UUID

/** Real identity + authorization + adminsecurity providers; only mail transport is a test double. */
@Tag("postgres")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(IdentityIntegrationTest.MailOnly::class)
class IdentityIntegrationTest {
    companion object {
        private val database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend"); withUsername("identity_integration"); withPassword("isolated-integration-test-password"); start()
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl); registry.add("spring.datasource.username",database::getUsername); registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }
            registry.add("qanda.backend.mode") { "test" }; registry.add("server.address") { "127.0.0.1" }; registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 43 }) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 51 }) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32) { 59 }) }
        }
    }
    @TestConfiguration class MailOnly {
        @Bean @Primary fun mail(jdbc: JdbcTemplate,tx: JdbcTransactions) = IdentityTestMail(jdbc,tx)
    }
    @Autowired lateinit var service: IdentityService
    @Autowired lateinit var bootstrap: AdminBootstrapService
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var mail: IdentityTestMail
    private val password = "Integrated-password-123"
    private fun JsonNode.uuid(field: String) = UUID.fromString(this[field].asText())
    private fun request(method: HttpMethod,path: String,body: Any? = null,token: String? = null,status: Int = 200,key: UUID = UUID.randomUUID()): JsonNode {
        val headers = HttpHeaders().apply { contentType=MediaType.APPLICATION_JSON; set("X-Request-Id",UUID.randomUUID().toString()); set("Idempotency-Key",key.toString()); token?.let(::setBearerAuth) }
        val result = http.exchange("/api/v1$path",method,HttpEntity(body?.let(mapper::writeValueAsString),headers),String::class.java)
        assertEquals(status,result.statusCode.value(),result.body)
        assertEquals("no-store",result.headers.getFirst("Cache-Control"))
        return result.body?.let(mapper::readTree) ?: mapper.nullNode()
    }
    private fun challenge(address: String,purpose: String = "REGISTER") = request(HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to purpose,"email" to address),status=201)
    private fun login(address: String,raw: String = password) = request(HttpMethod.POST,"/auth/sessions",mapOf("email" to address,"password" to raw,"clientType" to ClientType.ADMIN_WEB,"deviceId" to UUID.randomUUID()),status=201)["accessToken"].asText()
    @Test fun `real A providers support first admin organization registration revocation and identity audit mappings`() {
        assertEquals(listOf("0001","1000","1100","1200","1450","1500"),jdbc.rows("SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank").map { it.text("version") })
        jdbc.execute("CREATE TABLE identity_test_mail(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES identity_email_challenge(id))")
        val proof = challenge("operator@example.com")
        val prepared = service.prepareLocalBootstrapPassword(password)
        val operator = bootstrap.bootstrap(proof.uuid("challengeId"),mail.codes.getValue(proof.uuid("challengeId")),prepared,"管理员",LocalOperatorProof("BOOTSTRAP",UUID.randomUUID()),UUID.randomUUID())
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM authz_membership",Long::class.java)!!)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM admin_audit_entry WHERE action='ADMIN_BOOTSTRAPPED'",Long::class.java)!!)
        val admin = login("operator@example.com")
        assertTrue(request(HttpMethod.GET,"/me",token=admin)["adminEligible"].asBoolean())
        val college = request(HttpMethod.POST,"/admin/colleges",mapOf("name" to "工程学院"),admin,201).uuid("resourceId")
        val major = request(HttpMethod.POST,"/admin/colleges/$college/majors",mapOf("name" to "软件工程"),admin,201).uuid("resourceId")
        assertEquals(1,request(HttpMethod.GET,"/colleges")["totalItems"].asInt())
        assertEquals(major.toString(),request(HttpMethod.GET,"/colleges/$college/majors")["items"][0]["majorId"].asText())
        val userProof = challenge("student@example.com")
        val registration = request(HttpMethod.POST,"/auth/email-registrations",mapOf("challengeId" to userProof.uuid("challengeId"),"code" to mail.codes.getValue(userProof.uuid("challengeId")),"password" to password,"collegeId" to college,"majorId" to major),status=201)
        val userId = registration.uuid("accountId"); var user = login("student@example.com")
        assertEquals(major.toString(),request(HttpMethod.GET,"/me/membership",token=user)["membership"]["majorId"].asText())
        request(HttpMethod.GET,"/admin/users",token=user,status=403)
        request(HttpMethod.GET,"/admin/users/${UUID.randomUUID()}",token=admin,status=404)
        val summary = request(HttpMethod.GET,"/admin/users/$userId",token=admin)
        assertEquals("s***@example.com",summary["maskedEmail"].asText()); assertFalse(summary["adminEligible"].asBoolean())
        assertEquals(major.toString(),summary["membership"]["majorId"].asText())
        request(HttpMethod.PUT,"/admin/users/$userId/status",mapOf("status" to "DISABLED","expectedVersion" to 1),admin)
        request(HttpMethod.GET,"/me",token=user,status=401)
        request(HttpMethod.PUT,"/admin/users/$userId/status",mapOf("status" to "ACTIVE","expectedVersion" to 2),admin)
        request(HttpMethod.GET,"/me",token=user,status=401)
        user = login("student@example.com")
        request(HttpMethod.PATCH,"/me/profile",mapOf("nickname" to "学习用户","expectedVersion" to 3),user)
        val wxBinding = mapOf("code" to "local-learner-3:${UUID.randomUUID()}","expectedVersion" to 4)
        request(HttpMethod.PUT,"/me/wechat-binding",wxBinding,user,204)
        user = login("student@example.com")
        val reset = challenge("student@example.com","RESET_PASSWORD")
        request(HttpMethod.POST,"/auth/password-resets",mapOf("challengeId" to reset.uuid("challengeId"),"code" to mail.codes.getValue(reset.uuid("challengeId")),"newPassword" to password),status=204)
        request(HttpMethod.GET,"/me",token=user,status=401)
        user = login("student@example.com")
        val page = request(HttpMethod.GET,"/me/sessions",token=user)
        assertEquals(1,page["totalItems"].asInt())
        request(HttpMethod.DELETE,"/me/sessions/${page["items"][0]["sessionId"].asText()}",token=user,status=204)
        val lastAdmin = request(HttpMethod.PUT,"/admin/users/${operator.accountId}/status",mapOf("status" to "DISABLED","expectedVersion" to 1),admin,409)
        assertEquals("LAST_ADMIN_REQUIRED",lastAdmin["code"].asText())
        val recipient = request(HttpMethod.GET,"/accounts/by-code/${registration["accountCode"].asText()}",token=admin)
        assertEquals("学习用户",recipient["nickname"].asText())
        fun wx() = request(HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-1:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))
        val ticket = wx()
        val wxRegistered = request(HttpMethod.POST,"/auth/wechat-registrations",mapOf("registrationToken" to ticket["registrationToken"].asText(),"collegeId" to college,"majorId" to major),status=201)
        var wxToken = wx()["accessToken"].asText()
        assertTrue(request(HttpMethod.GET,"/me",token=wxToken)["profile"]["email"].isNull)
        val emailProof = request(HttpMethod.POST,"/me/email-challenges",mapOf("purpose" to "BIND_EMAIL","email" to "wechat@example.com"),wxToken,201)
        request(HttpMethod.PUT,"/me/email-binding",mapOf("challengeId" to emailProof.uuid("challengeId"),"code" to mail.codes.getValue(emailProof.uuid("challengeId")),"expectedVersion" to 1),wxToken,204)
        request(HttpMethod.GET,"/me",token=wxToken,status=401)
        wxToken = wx()["accessToken"].asText()
        val passwordProof = request(HttpMethod.POST,"/me/email-challenges",mapOf("purpose" to "CHANGE_PASSWORD"),wxToken,201)
        request(HttpMethod.PUT,"/me/password",mapOf("challengeId" to passwordProof.uuid("challengeId"),"code" to mail.codes.getValue(passwordProof.uuid("challengeId")),"newPassword" to password,"expectedVersion" to 2),wxToken,204)
        wxToken = login("wechat@example.com")
        val change = request(HttpMethod.POST,"/me/email-changes",mapOf("newEmail" to "changed@example.com","expectedVersion" to 3),wxToken,201)
        request(HttpMethod.POST,"/me/email-changes/${change["emailChangeId"].asText()}/confirmations",mapOf("oldCode" to mail.codes.getValue(change.uuid("oldChallengeId")),"newCode" to mail.codes.getValue(change.uuid("newChallengeId")),"expectedVersion" to 3),wxToken,204)
        request(HttpMethod.GET,"/me",token=wxToken,status=401)
        wxToken = login("changed@example.com")
        request(HttpMethod.DELETE,"/auth/sessions/current",token=wxToken,status=204)
        request(HttpMethod.DELETE,"/auth/sessions/current",token=wxToken,status=204)
        assertEquals(wxRegistered["accountId"],wx()["accountId"])
        val audits = jdbc.rows("SELECT source_module,action,actor_kind FROM admin_audit_entry")
        assertTrue(audits.any { it["action"] == "ACCOUNT_REGISTERED" && it["source_module"] == "IDENTITY" })
        assertTrue(audits.any { it["action"] == "MEMBERSHIP_CHANGED" && it["source_module"] == "AUTHORIZATION" })
        assertEquals(0,jdbc.queryForObject("""SELECT count(*) FROM authz_membership_change c
            LEFT JOIN admin_audit_entry e ON e.source_module='AUTHORIZATION' AND e.event_id=c.change_id AND e.action='MEMBERSHIP_CHANGED'
            WHERE e.id IS NULL""",Long::class.java)!!)
        assertTrue(audits.any { it["action"] == "CREDENTIAL_CHANGED" }); assertTrue(audits.any { it["action"] == "IDENTITY_BOUND" }); assertTrue(audits.any { it["action"] == "SESSION_REVOKED" })
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM admin_audit_entry WHERE action='ACCOUNT_STATUS_CHANGED'",Long::class.java)!!)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname='authz_membership_account_fk' AND convalidated",Long::class.java)!!)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname='admin_qualification_account_fk' AND convalidated",Long::class.java)!!)
    }
}
