package qanda.backend.authorization

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
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
import qanda.backend.identity.IdentityService
import qanda.backend.identity.IdentityTestMail
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import java.util.UUID

/** Actual Q03/Q04/Q12 HTTP providers and A migrations; mail capture reuses Q03's test fixture. */
@Tag("postgres")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AuthorizationIntegrationTest.MailCapture::class)
class AuthorizationIntegrationTest {
    private class IsolatedPostgres:PostgreSQLContainer<IsolatedPostgres>("postgres:17.6-alpine")
    companion object {
        private val database=IsolatedPostgres().withDatabaseName("qanda_backend").apply { start() }
        @JvmStatic @DynamicPropertySource fun properties(registry:DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl);registry.add("spring.datasource.username",database::getUsername);registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }
            registry.add("qanda.backend.mode") { "test" };registry.add("server.address") { "127.0.0.1" };registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32){61}) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32){67}) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32){71}) }
        }
        @JvmStatic @AfterAll fun stop() { database.stop() }
    }
    @TestConfiguration class MailCapture {
        @Bean @Primary fun mail(jdbc:JdbcTemplate,tx:JdbcTransactions)=IdentityTestMail(jdbc,tx)
    }
    @Autowired lateinit var identity:IdentityService
    @Autowired lateinit var bootstrap:AdminBootstrapService
    @Autowired lateinit var jdbc:JdbcTemplate
    @Autowired lateinit var http:TestRestTemplate
    @Autowired lateinit var mapper:ObjectMapper
    @Autowired lateinit var mail:IdentityTestMail

    @Test fun `real A providers verify 15 authorization operations and keep 12 content operations closed`() {
        val evidence=mutableListOf<Map<String,Any>>()
        fun call(op:String,method:HttpMethod,path:String,body:Any?=null,token:String?=null,status:Int=200,key:UUID=UUID.randomUUID()):JsonNode {
            val headers=HttpHeaders().apply { contentType=MediaType.APPLICATION_JSON;set("Idempotency-Key",key.toString());token?.let(::setBearerAuth) }
            val result=http.exchange("/api/v1$path",method,HttpEntity(body?.let(mapper::writeValueAsString),headers),String::class.java)
            assertEquals(status,result.statusCode.value(),"$op: ${result.body}")
            assertNotNull(result.headers.getFirst("X-Request-Id"));assertEquals("no-store",result.headers.getFirst("Cache-Control"))
            val value=mapper.readTree(result.body)
            if(op.startsWith("authorization"))evidence+=mapOf("operationId" to op,"method" to method.name(),"path" to "/api/v1$path","status" to status,"body" to value)
            return value
        }
        fun JsonNode.id(field:String)=UUID.fromString(this[field].asText())
        jdbc.execute("CREATE TABLE identity_test_mail(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES identity_email_challenge(id))")
        val challenge=call("challenge",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "authorization-operator@example.com"),status=201)
        val password="Authorization-test-password-123"
        bootstrap.bootstrap(challenge.id("challengeId"),mail.codes.getValue(challenge.id("challengeId")),identity.prepareLocalBootstrapPassword(password),"管理员",LocalOperatorProof("BOOTSTRAP",UUID.randomUUID()),UUID.randomUUID())
        val admin=call("login",HttpMethod.POST,"/auth/sessions",mapOf("email" to "authorization-operator@example.com","password" to password,"clientType" to "ADMIN_WEB","deviceId" to UUID.randomUUID()),status=201)["accessToken"].asText()
        val college=call("authorizationCreateCollege",HttpMethod.POST,"/admin/colleges",mapOf("name" to "集成学院"),admin,201).id("resourceId")
        val major=call("authorizationCreateMajor",HttpMethod.POST,"/admin/colleges/$college/majors",mapOf("name" to "集成专业"),admin,201).id("resourceId")
        call("authorizationListSelectableColleges",HttpMethod.GET,"/colleges")
        call("authorizationListSelectableMajors",HttpMethod.GET,"/colleges/$college/majors")
        call("authorizationAdminListColleges",HttpMethod.GET,"/admin/colleges",token=admin)
        call("authorizationAdminGetCollege",HttpMethod.GET,"/admin/colleges/$college",token=admin)
        call("authorizationUpdateCollege",HttpMethod.PUT,"/admin/colleges/$college",mapOf("name" to "集成学院甲","status" to "ACTIVE","expectedVersion" to 1),admin)
        call("authorizationAdminListMajors",HttpMethod.GET,"/admin/colleges/$college/majors",token=admin)
        call("authorizationAdminGetMajor",HttpMethod.GET,"/admin/majors/$major",token=admin)
        call("authorizationUpdateMajor",HttpMethod.PUT,"/admin/majors/$major",mapOf("name" to "集成专业甲","status" to "ACTIVE","expectedVersion" to 1),admin)
        assertTrue(call("authorizationGetOwnMembership",HttpMethod.GET,"/me/membership",token=admin)["membership"].isNull)
        call("authorizationSetOwnMembership",HttpMethod.PUT,"/me/membership",mapOf("collegeId" to college,"majorId" to major,"expectedVersion" to null),admin)
        val ticket=call("wechat",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))
        val registered=call("register",HttpMethod.POST,"/auth/wechat-registrations",mapOf("registrationToken" to ticket["registrationToken"].asText(),"collegeId" to college,"majorId" to major),status=201)
        val learner=registered.id("accountId")
        val token=call("wechat",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))["accessToken"].asText()
        call("authorizationAdminGetMembership",HttpMethod.GET,"/admin/accounts/$learner/membership",token=admin)
        assertFalse(call("authorizationAdminSetMembership",HttpMethod.PUT,"/admin/accounts/$learner/membership",mapOf("collegeId" to college,"majorId" to major,"expectedVersion" to 1),admin)["changed"].asBoolean())
        call("authorizationAdminListMembershipHistory",HttpMethod.GET,"/admin/accounts/$learner/membership-history",token=admin)
        call("forbidden",HttpMethod.GET,"/admin/colleges",token=token,status=403)
        call("anonymous",HttpMethod.GET,"/me/membership",status=401)
        call("bad-admin-token",HttpMethod.GET,"/admin/colleges",token="invalid-token",status=401)
        val subject=UUID.randomUUID()
        val closed=listOf(
            Triple("authorizationExplainAccountSchoolAccess",HttpMethod.GET,"/admin/accounts/$learner/school-access"),
            Triple("authorizationGetSchoolPolicy",HttpMethod.GET,"/admin/subjects/$subject/school-access"),
            Triple("authorizationSetSchoolPublic",HttpMethod.PUT,"/admin/subjects/$subject/school-access"),
            Triple("authorizationListCollegeGrants",HttpMethod.GET,"/admin/subjects/$subject/college-grants"),
            Triple("authorizationSetCollegeGrant",HttpMethod.PUT,"/admin/subjects/$subject/college-grants/$college"),
            Triple("authorizationListMajorGrants",HttpMethod.GET,"/admin/subjects/$subject/major-grants"),
            Triple("authorizationSetMajorGrant",HttpMethod.PUT,"/admin/subjects/$subject/major-grants/$major"),
            Triple("authorizationListSchoolAccountRules",HttpMethod.GET,"/admin/subjects/$subject/account-rules"),
            Triple("authorizationSetSchoolAccountRule",HttpMethod.PUT,"/admin/subjects/$subject/account-rules/$learner"),
            Triple("authorizationListUserSubjectShares",HttpMethod.GET,"/subjects/$subject/shares"),
            Triple("authorizationGrantUserSubjectShare",HttpMethod.POST,"/subjects/$subject/shares"),
            Triple("authorizationRevokeUserSubjectShare",HttpMethod.POST,"/subjects/$subject/share-revocations"))
        for((op,method,path) in closed) {
            val body=when(op) {
                "authorizationSetSchoolPublic"->mapOf("isPublic" to true,"expectedVersion" to 1)
                "authorizationSetCollegeGrant","authorizationSetMajorGrant"->mapOf("enabled" to true,"expectedVersion" to 1)
                "authorizationSetSchoolAccountRule"->mapOf("granted" to true,"inheritanceBlocked" to false,"expectedVersion" to 1)
                "authorizationGrantUserSubjectShare"->mapOf("accountCode" to registered["accountCode"].asText(),"expectedVersion" to 1)
                "authorizationRevokeUserSubjectShare"->mapOf("recipientAccountId" to learner,"expectedVersion" to 1)
                else->null
            }
            assertEquals("CONTENT_INTEGRATION_NOT_READY",call(op,method,path,body,admin,503)["code"].asText())
        }
        assertEquals(27,evidence.map { it["operationId"] }.distinct().size)
        val output=Path.of("build/reports/authorization-integration-evidence.json");Files.createDirectories(output.parent);mapper.writerWithDefaultPrettyPrinter().writeValue(output.toFile(),evidence)
        assertEquals(1L,jdbc.queryForObject("""SELECT count(*) FROM authz_membership_change h JOIN admin_audit_entry a ON a.event_id=h.change_id
            WHERE h.account_id=? AND a.source_module='AUTHORIZATION' AND a.action='MEMBERSHIP_CHANGED'""",Long::class.java,learner)!!)
        val retryTicket=call("wechat",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-3:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))
        val retryBody=mapOf("registrationToken" to retryTicket["registrationToken"].asText(),"collegeId" to college,"majorId" to major)
        val retryKey=UUID.randomUUID()
        val tables=listOf("identity_account","identity_command_receipt","authz_membership","authz_membership_change","authz_command_receipt","admin_audit_entry")
        fun counts()=tables.associateWith { jdbc.queryForObject("SELECT count(*) FROM $it",Long::class.java)!! }
        val before=counts()
        jdbc.execute("""CREATE FUNCTION authz_test_reject_membership_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.source_module='AUTHORIZATION' AND NEW.action='MEMBERSHIP_CHANGED' THEN RAISE EXCEPTION 'test audit fault'; END IF; RETURN NEW; END $$""")
        jdbc.execute("CREATE TRIGGER authz_test_audit_fault BEFORE INSERT ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION authz_test_reject_membership_audit()")
        try {
            assertEquals("AUDIT_UNAVAILABLE",call("audit-fault",HttpMethod.POST,"/auth/wechat-registrations",retryBody,status=503,key=retryKey)["code"].asText())
            assertEquals(before,counts())
        } finally {
            jdbc.execute("DROP TRIGGER authz_test_audit_fault ON admin_audit_entry")
            jdbc.execute("DROP FUNCTION authz_test_reject_membership_audit()")
        }
        val retried=call("audit-retry",HttpMethod.POST,"/auth/wechat-registrations",retryBody,status=201,key=retryKey).id("accountId")
        assertEquals(1L,jdbc.queryForObject("""SELECT count(*) FROM authz_membership_change h JOIN admin_audit_entry a ON a.event_id=h.change_id
            WHERE h.account_id=? AND a.source_module='AUTHORIZATION' AND a.action='MEMBERSHIP_CHANGED'""",Long::class.java,retried)!!)
    }
}
