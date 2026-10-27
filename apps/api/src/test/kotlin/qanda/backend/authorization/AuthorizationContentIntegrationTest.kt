package qanda.backend.authorization

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Import
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.adminsecurity.AdminBootstrapService
import qanda.backend.adminsecurity.api.LocalOperatorProof
import qanda.backend.authorization.api.AuthorizationContentPort
import qanda.backend.authorization.api.GuardMode
import qanda.backend.content.ContentStore
import qanda.backend.identity.IdentityService
import qanda.backend.identity.IdentityTestMail
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Files
import java.nio.file.Path
import java.sql.SQLException
import java.util.Base64
import java.util.UUID

/** Full real migrations and ContentStore; external mail/WeChat stay explicit local fixtures. */
@Tag("postgres")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AuthorizationIntegrationTest.MailCapture::class)
class AuthorizationContentIntegrationTest {
    private class IsolatedPostgres:PostgreSQLContainer<IsolatedPostgres>("postgres:17.6-alpine")
    companion object {
        private val database=IsolatedPostgres().withDatabaseName("qanda_backend").apply { start() }
        @JvmStatic @DynamicPropertySource fun properties(registry:DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl);registry.add("spring.datasource.username",database::getUsername);registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration" }
            registry.add("qanda.backend.mode") { "test" };registry.add("server.address") { "127.0.0.1" };registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32){73}) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32){79}) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32){83}) }
        }
        @JvmStatic @AfterAll fun stop() { database.stop() }
    }
    @Autowired lateinit var jdbc:JdbcTemplate
    @Autowired lateinit var tx:JdbcTransactions
    @Autowired lateinit var identity:IdentityService
    @Autowired lateinit var bootstrap:AdminBootstrapService
    @Autowired lateinit var content:AuthorizationContentPort
    @Autowired lateinit var gate:AuthorizationContentGate
    @Autowired lateinit var http:TestRestTemplate
    @Autowired lateinit var mapper:ObjectMapper
    @Autowired lateinit var mail:IdentityTestMail

    @Test fun `validated content FK opens actual provider authorization and rejects orphan rows`() {
        val evidence=linkedMapOf<String,Any>()
        val responses=mutableListOf<Map<String,Any>>()
        evidence["responses"]=responses
        fun call(op:String,method:HttpMethod,path:String,body:Any?=null,token:String?=null,status:Int=200):JsonNode {
            val headers=HttpHeaders().apply { contentType=MediaType.APPLICATION_JSON;set("Idempotency-Key",UUID.randomUUID().toString());token?.let(::setBearerAuth) }
            val result=http.exchange("/api/v1$path",method,HttpEntity(body?.let(mapper::writeValueAsString),headers),String::class.java)
            val value=mapper.readTree(result.body)
            if(op.startsWith("authorization") || op.startsWith("content"))responses+=mapOf("operationId" to op,"method" to method.name(),"path" to "/api/v1$path","expectedStatus" to status,"status" to result.statusCode.value(),"body" to value)
            assertEquals(status,result.statusCode.value(),"$op: ${result.body}")
            return value
        }
        fun JsonNode.id(field:String)=UUID.fromString(this[field].asText())
        fun rejectFk(block:()->Unit) {
            val failure=assertThrows(DataIntegrityViolationException::class.java,block)
            assertEquals("23503",generateSequence<Throwable>(failure){it.cause}.filterIsInstance<SQLException>().first().sqlState)
        }
        try {
            assertEquals("qanda_backend",jdbc.queryForObject("SELECT current_database()",String::class.java))
            assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM content_subject",Long::class.java)!!)
            assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM authz_subject_policy",Long::class.java)!!)
            val migrations=jdbc.queryForList("SELECT installed_rank,version,script,success FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank")
            assertTrue(migrations.all { it["success"]==true })
            val versions=migrations.map { it["version"].toString() }
            assertTrue(versions.containsAll(listOf("2100","2450","2500")))
            assertTrue(versions.indexOf("2100")<versions.indexOf("2450") && versions.indexOf("2450")<versions.indexOf("2500"))
            evidence["migrations"]=migrations
            val constraint=jdbc.queryForMap("""SELECT conname,convalidated,conrelid::regclass::text AS source_table,
                confrelid::regclass::text AS target_table,pg_get_constraintdef(oid) AS definition
                FROM pg_constraint WHERE conname='authz_subject_policy_content_fk' AND conrelid='authz_subject_policy'::regclass""")
            assertEquals(true,constraint["convalidated"]);assertEquals("content_subject",constraint["target_table"])
            assertEquals("FOREIGN KEY (subject_id) REFERENCES content_subject(id) ON DELETE RESTRICT",constraint["definition"])
            evidence["constraint"]=constraint
            rejectFk { jdbc.update("INSERT INTO authz_subject_policy VALUES(?,false,1,now(),now())",UUID.randomUUID()) }
            evidence["orphanInsertSqlState"]="23503"
            assertTrue(content is ContentStore)
            tx.required { gate.requireReadyInTransaction();Unit }
            evidence["actualProvider"]="ContentStore"
            evidence["readiness"]="PASS"

            jdbc.execute("CREATE TABLE identity_test_mail(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES identity_email_challenge(id))")
            val proof=call("challenge",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to "authorization-content@example.com"),status=201)
            val password="Authorization-content-test-123"
            bootstrap.bootstrap(proof.id("challengeId"),mail.codes.getValue(proof.id("challengeId")),identity.prepareLocalBootstrapPassword(password),"验收管理员",LocalOperatorProof("BOOTSTRAP",UUID.randomUUID()),UUID.randomUUID())
            val admin=call("login",HttpMethod.POST,"/auth/sessions",mapOf("email" to "authorization-content@example.com","password" to password,"clientType" to "ADMIN_WEB","deviceId" to UUID.randomUUID()),status=201)["accessToken"].asText()
            val college=call("authorizationCreateCollege",HttpMethod.POST,"/admin/colleges",mapOf("name" to "验收学院"),admin,201).id("resourceId")
            val major=call("authorizationCreateMajor",HttpMethod.POST,"/admin/colleges/$college/majors",mapOf("name" to "验收专业"),admin,201).id("resourceId")
            val ticket=call("wechat",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))
            val registered=call("registration",HttpMethod.POST,"/auth/wechat-registrations",mapOf("registrationToken" to ticket["registrationToken"].asText(),"collegeId" to college,"majorId" to major),status=201)
            val learner=registered.id("accountId")
            val learnerToken=call("wechat",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()))["accessToken"].asText()
            val school=call("contentCreateSubject",HttpMethod.POST,"/subjects",mapOf("source" to "SCHOOL","title" to "验收共享科目"),admin,201).id("subjectId")
            val personal=call("contentCreateSubject",HttpMethod.POST,"/subjects",mapOf("source" to "USER","title" to "验收个人科目"),admin,201).id("subjectId")
            rejectFk { jdbc.update("DELETE FROM content_subject WHERE id=?",school) }
            evidence["referencedSubjectDeleteSqlState"]="23503"
            tx.required {
                gate.requireReadyInTransaction()
                val guard=content.lockSubjectInTransaction(school,GuardMode.SHARE)
                assertEquals(school,content.describeLocked(guard).id)
                Unit
            }
            call("authorizationExplainAccountSchoolAccess",HttpMethod.GET,"/admin/accounts/$learner/school-access",token=admin)
            call("authorizationGetSchoolPolicy",HttpMethod.GET,"/admin/subjects/$school/school-access",token=admin)
            call("authorizationSetSchoolPublic",HttpMethod.PUT,"/admin/subjects/$school/school-access",mapOf("isPublic" to true,"expectedVersion" to 1),admin)
            call("authorizationListCollegeGrants",HttpMethod.GET,"/admin/subjects/$school/college-grants",token=admin)
            call("authorizationSetCollegeGrant",HttpMethod.PUT,"/admin/subjects/$school/college-grants/$college",mapOf("enabled" to true,"expectedVersion" to 2),admin)
            call("authorizationListMajorGrants",HttpMethod.GET,"/admin/subjects/$school/major-grants",token=admin)
            call("authorizationSetMajorGrant",HttpMethod.PUT,"/admin/subjects/$school/major-grants/$major",mapOf("enabled" to true,"expectedVersion" to 3),admin)
            call("authorizationListSchoolAccountRules",HttpMethod.GET,"/admin/subjects/$school/account-rules",token=admin)
            call("authorizationSetSchoolAccountRule",HttpMethod.PUT,"/admin/subjects/$school/account-rules/$learner",mapOf("granted" to true,"inheritanceBlocked" to true,"expectedVersion" to 4),admin)
            call("authorizationGrantUserSubjectShare",HttpMethod.POST,"/subjects/$personal/shares",mapOf("accountCode" to registered["accountCode"].asText(),"expectedVersion" to 1),admin)
            val shares=call("authorizationListUserSubjectShares",HttpMethod.GET,"/subjects/$personal/shares",token=admin)
            assertEquals(learner.toString(),shares["items"][0]["recipientAccountId"].asText())
            call("contentGetSubject",HttpMethod.GET,"/subjects/$personal",token=learnerToken)
            call("authorizationRevokeUserSubjectShare",HttpMethod.POST,"/subjects/$personal/share-revocations",mapOf("recipientAccountId" to learner,"expectedVersion" to 2),admin)
            call("contentGetSubject",HttpMethod.GET,"/subjects/$personal",token=learnerToken,status=404)
            val required=setOf("authorizationExplainAccountSchoolAccess","authorizationGetSchoolPolicy","authorizationSetSchoolPublic","authorizationListCollegeGrants","authorizationSetCollegeGrant","authorizationListMajorGrants","authorizationSetMajorGrant","authorizationListSchoolAccountRules","authorizationSetSchoolAccountRule","authorizationListUserSubjectShares","authorizationGrantUserSubjectShare","authorizationRevokeUserSubjectShare")
            assertTrue(responses.map { it["operationId"] }.containsAll(required))
            evidence["contentDependentAuthorizationSuccesses"]=required.size
        } finally {
            val output=Path.of(".backend-runtime/verification/authorization-content-fk/http-evidence.json")
            Files.createDirectories(output.parent);mapper.writerWithDefaultPrettyPrinter().writeValue(output.toFile(),evidence)
        }
    }
}
