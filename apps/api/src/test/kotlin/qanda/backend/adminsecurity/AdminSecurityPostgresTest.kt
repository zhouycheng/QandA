package qanda.backend.adminsecurity

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.dao.DataAccessException
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.adminsecurity.api.*
import qanda.backend.authorization.api.AuthorizationActor
import qanda.backend.identity.IdentityCrypto
import qanda.backend.identity.IdentityCommand
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.IdentityService
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.mail.IdentityMailPort
import qanda.backend.platform.mail.PreparedMailEnvelope
import qanda.backend.platform.transaction.JdbcTransactions
import java.sql.Timestamp
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.*

/** Only mail transport is doubled: codes are still generated, MAC-verified and consumed by Q03. */
class AdminTestMail(private val jdbc: JdbcTemplate,private val tx: JdbcTransactions) : IdentityMailPort {
    val codes=ConcurrentHashMap<UUID,String>()
    override fun prepareIdentityMailEnvelope(challengeId: UUID,recipient: String,code: String,templateCode: String,templateVersion: Int,expiresAt: Instant): PreparedMailEnvelope {
        codes[challengeId]=code
        return PreparedMailEnvelope(challengeId,templateCode,templateVersion,expiresAt,"test-ciphertext","test-nonce",1)
    }
    override fun enqueueIdentityMailInTransaction(challengeId: UUID,expiresAt: Instant,encryptedMessageRef: PreparedMailEnvelope,requestId: UUID): UUID = tx.mandatory {
        UUID.randomUUID().also { jdbc.update("INSERT INTO admin_test_mail VALUES (?,?)",it,challengeId) }
    }
}
@TestConfiguration
class AdminTestProviders {
    @Bean @Primary fun adminTestMail(jdbc: JdbcTemplate,tx: JdbcTransactions)=AdminTestMail(jdbc,tx)
}

@Tag("postgres")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AdminTestProviders::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class AdminSecurityPostgresTest {
    companion object {
        private val database=PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend");withUsername("admin_test");withPassword("isolated-admin-test");start()
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl)
            registry.add("spring.datasource.username",database::getUsername)
            registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity" }
            registry.add("spring.flyway.target") { "1500" }
            registry.add("qanda.backend.mode") { "test" }
            registry.add("server.address") { "127.0.0.1" }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 41 }) }
            registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+Base64.getEncoder().encodeToString(ByteArray(32) { 43 }) }
            registry.add("BACKEND_IDENTITY_RATE_KEY") { Base64.getEncoder().encodeToString(ByteArray(32) { 47 }) }
        }
    }
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var identity: IdentityService
    @Autowired lateinit var guards: IdentityGuards
    @Autowired lateinit var crypto: IdentityCrypto
    @Autowired lateinit var access: AdminAccess
    @Autowired lateinit var service: AdminService
    @Autowired lateinit var bootstrap: AdminBootstrapService
    @Autowired lateinit var authorizationAdapter: AdminAuthorizationAdapter
    @Autowired lateinit var mail: AdminTestMail
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var clock: Clock
    private val password="Test-admin-password-123"
    private lateinit var prepared: PreparedPassword
    private lateinit var base: User
    private val contract by lazy { mapper.readTree(Path.of("contracts/modules/admin-security/openapi.yaml").toFile()) }
    private val evidence=mutableListOf<Map<String,Any>>()
    private data class User(val id: UUID,val email: String,val token: String,val auth: AuthContext)
    private fun now()=Timestamp.from(clock.instant())
    private fun count(table: String,where: String="true",vararg args: Any?)=jdbc.queryForObject("SELECT count(*) FROM $table WHERE $where",Long::class.java,*args)!!
    private fun accountVersion(id: UUID)=jdbc.queryForObject("SELECT version FROM identity_account WHERE id=?",Long::class.java,id)!!
    private fun qualificationVersion(id: UUID)=jdbc.queryForObject("SELECT version FROM admin_qualification WHERE account_id=?",Long::class.java,id)!!
    private fun activeAdmins()=count("admin_qualification q JOIN identity_account a ON a.id=q.account_id","q.qualified AND a.status='ACTIVE'")
    private fun login(id: UUID,address: String): User {
        val grant=identity.createEmailSession(address,password,ClientType.ADMIN_WEB,UUID.randomUUID(),false,"admin-test-${UUID.randomUUID()}",UUID.randomUUID())
        return User(id,address,grant.accessToken,guards.authenticate(grant.accessToken,clock.instant()))
    }
    private fun fixture(qualified: Boolean=false): User {
        val id=UUID.randomUUID();val address="u-$id@example.com";val at=now()
        tx.required {
            jdbc.update("INSERT INTO identity_account(id,account_code,nickname,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE',?,?)",id,crypto.accountCode(),"测试%_账号",at,at)
            jdbc.update("INSERT INTO identity_email VALUES (?,?,?,?,?)",id,address,address,at,at)
            jdbc.update("INSERT INTO identity_password VALUES (?,?,?)",id,prepared.encoded,at)
            if(qualified) jdbc.update("INSERT INTO admin_qualification(account_id,qualified,granted_at,created_at,updated_at) VALUES (?,true,?,?,?)",id,at,at,at)
        }
        return login(id,address)
    }
    private fun command(target: UUID,qualification: Boolean,body: String,key: UUID=UUID.randomUUID(),requestId: UUID=UUID.randomUUID())=AdminCommand(requestId,key,"PUT",if(qualification) "/api/v1/admin/administrators/$target/qualification" else "/api/v1/admin/users/$target/status","application/json",body.toByteArray())
    private fun qualify(actor: User,target: UUID,value: Boolean,expected: Long?)=service.setQualification(actor.auth,target,SetQualification(value,expected),command(target,true,"""{"qualified":$value,"expectedVersion":$expected}"""))
    private fun status(actor: User,target: UUID,value: AccountStatus,expected: Long)=service.setAccountStatus(actor.auth,target,SetAccountStatus(value,expected),command(target,false,"""{"status":"$value","expectedVersion":$expected}"""))
    private fun error(code: String,block: ()->Unit): ApiException=assertThrows(ApiException::class.java,block).also { assertEquals(code,it.code) }
    private fun <T> parallel(vararg blocks: ()->T): List<Result<T>> {
        val pool=Executors.newFixedThreadPool(blocks.size);val barrier=CyclicBarrier(blocks.size)
        try { return blocks.map { block -> pool.submit<Result<T>> { barrier.await(10,TimeUnit.SECONDS);runCatching(block) } }.map { it.get(20,TimeUnit.SECONDS) } }
        finally { pool.shutdownNow() }
    }
    private fun failAudit(action: AuditAction,block: ()->Unit) {
        jdbc.execute("CREATE FUNCTION admin_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.action=''${action.name}'' THEN RAISE EXCEPTION ''test audit failure''; END IF; RETURN NEW; END'")
        jdbc.execute("CREATE TRIGGER admin_test_fail_audit BEFORE INSERT ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION admin_test_fail_audit()")
        try { block() } finally { jdbc.execute("DROP TRIGGER admin_test_fail_audit ON admin_audit_entry");jdbc.execute("DROP FUNCTION admin_test_fail_audit()") }
    }
    private fun restoreQualifications() {
        // Fixture changes only in this class's disposable database; audit history is never deleted.
        jdbc.update("UPDATE admin_qualification SET qualified=false,revoked_at=GREATEST(clock_timestamp(),granted_at),updated_at=GREATEST(clock_timestamp(),granted_at) WHERE qualified")
        jdbc.update("UPDATE admin_qualification SET qualified=true,revoked_at=NULL,updated_at=GREATEST(clock_timestamp(),granted_at) WHERE account_id=?",base.id)
    }
    @BeforeAll fun setup() {
        assertTrue(database.jdbcUrl.contains(":${database.firstMappedPort}/qanda_backend"))
        jdbc.execute("CREATE TABLE admin_test_mail(id uuid PRIMARY KEY,challenge_id uuid REFERENCES identity_email_challenge(id))")
        jdbc.execute("CREATE TABLE admin_test_effect(id uuid PRIMARY KEY)")
        prepared=identity.prepareLocalBootstrapPassword(password)
    }
    @AfterAll fun stop() {
        try {
            val output=Path.of("build/admin-security-qa-a-002/http-evidence.json")
            Files.createDirectories(output.parent);mapper.writeValue(output.toFile(),evidence)
        } finally { database.stop() }
    }
    @BeforeEach fun isolate() { if(::base.isInitialized) restoreQualifications() }
    @Test @Order(1) fun `B00 verifies real REGISTER proof atomically and concurrent bootstrap only creates one administrator`() {
        bootstrap.assertAvailable()
        val one=identity.requestPublicEmailChallenge("REGISTER","first@example.com","bootstrap-one",UUID.randomUUID())
        val two=identity.requestPublicEmailChallenge("REGISTER","second@example.com","bootstrap-two",UUID.randomUUID())
        val firstCode=mail.codes.getValue(one.challengeId)
        val wrong=if(firstCode=="000000") "111111" else "000000"
        val operator=LocalOperatorProof("BOOTSTRAP",UUID.randomUUID())
        error("VERIFICATION_FAILED") { bootstrap.bootstrap(one.challengeId,wrong,prepared,null,operator,UUID.randomUUID()) }
        assertEquals(1,jdbc.queryForObject("SELECT failed_attempts FROM identity_email_challenge WHERE id=?",Int::class.java,one.challengeId)!!)
        failAudit(AuditAction.ADMIN_BOOTSTRAPPED) {
            error("AUDIT_UNAVAILABLE") { bootstrap.bootstrap(one.challengeId,firstCode,prepared,null,operator,UUID.randomUUID()) }
        }
        assertEquals(0,count("identity_account"));assertEquals(0,count("admin_qualification"))
        assertNull(jdbc.queryForMap("SELECT consumed_at FROM identity_email_challenge WHERE id=?",one.challengeId)["consumed_at"])
        assertNull(jdbc.queryForMap("SELECT bootstrap_completed_at FROM admin_control")["bootstrap_completed_at"])
        val results=parallel(
            { bootstrap.bootstrap(one.challengeId,firstCode,prepared,null,operator,UUID.randomUUID()) },
            { bootstrap.bootstrap(two.challengeId,mail.codes.getValue(two.challengeId),prepared,null,operator,UUID.randomUUID()) })
        assertEquals(1,results.count { it.isSuccess },results.toString())
        assertEquals("BOOTSTRAP_CLOSED",(results.single { it.isFailure }.exceptionOrNull() as ApiException).code)
        assertEquals(1,count("identity_account"));assertEquals(1,count("identity_password"));assertEquals(1,count("admin_qualification"))
        assertEquals(0,count("identity_auth_session"));assertEquals(0,count("authz_membership"))
        assertEquals(1,count("admin_audit_entry","action='ADMIN_BOOTSTRAPPED'"));assertEquals(0,count("admin_audit_entry","action='ACCOUNT_REGISTERED'"))
        assertEquals(1,count("identity_email_challenge","consumed_at IS NOT NULL"))
        error("BOOTSTRAP_CLOSED") { bootstrap.bootstrap(one.challengeId,firstCode,prepared,null,operator,UUID.randomUUID()) }
        error("BOOTSTRAP_CLOSED") { bootstrap.assertAvailable() }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE admin_control SET bootstrap_completed_at=NULL") }
        assertThrows(DataAccessException::class.java) { jdbc.update("DELETE FROM admin_control") }
        val registered=results.single { it.isSuccess }.getOrThrow()
        val address=jdbc.queryForObject("SELECT email FROM identity_email WHERE account_id=?",String::class.java,registered.accountId)!!
        base=login(registered.accountId,address)
        assertNull(service.getUser(base.auth,base.id,UUID.randomUUID()).membership)
    }
    @Test @Order(2) fun `both last administrator commands reject while no-op and raw byte receipt replay stay stable`() {
        error("LAST_ADMIN_REQUIRED") { qualify(base,base.id,false,qualificationVersion(base.id)) }
        error("LAST_ADMIN_REQUIRED") { status(base,base.id,AccountStatus.DISABLED,1) }
        val target=fixture();val body="""{"qualified":true,"expectedVersion":null}""";val cmd=command(target.id,true,body)
        val first=service.setQualification(base.auth,target.id,SetQualification(true,null),cmd)
        assertTrue(first.changed);assertEquals(1,first.version)
        assertEquals(first,service.setQualification(base.auth,target.id,SetQualification(true,null),cmd))
        assertEquals(1,count("admin_audit_entry","request_id=?",cmd.requestId))
        error("IDEMPOTENCY_CONFLICT") { service.setQualification(base.auth,target.id,SetQualification(true,null),command(target.id,true,"$body ",cmd.commandId)) }
        error("IDEMPOTENCY_CONFLICT") { service.setQualification(base.auth,base.id,SetQualification(true,null),command(base.id,true,body,cmd.commandId)) }
        error("VERSION_CONFLICT") { qualify(base,target.id,false,null) }
        assertFalse(qualify(base,target.id,true,1).changed)
        assertTrue(qualify(base,target.id,false,1).changed)
        assertTrue(qualify(base,target.id,true,2).changed)
        assertEquals(3,qualificationVersion(target.id))
        val statusCommand=command(target.id,false,"""{"status":"DISABLED","expectedVersion":1}""")
        val status=service.setAccountStatus(base.auth,target.id,SetAccountStatus(AccountStatus.DISABLED,1),statusCommand)
        assertEquals(status,service.setAccountStatus(base.auth,target.id,SetAccountStatus(AccountStatus.DISABLED,1),statusCommand))
        assertEquals(1,count("admin_audit_entry","request_id=?",statusCommand.requestId))
    }
    @Test @Order(3) fun `two administrators cannot mutually revoke disable or mix away the final active qualification`() {
        for(mode in 0..2) {
            restoreQualifications();val a=fixture(true);val b=fixture(true)
            jdbc.update("UPDATE admin_qualification SET qualified=false,revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE account_id=?",base.id)
            val results=parallel<Any>(
                { if(mode==1) status(a,b.id,AccountStatus.DISABLED,1) else qualify(a,b.id,false,1) },
                { if(mode==0) qualify(b,a.id,false,1) else status(b,a.id,AccountStatus.DISABLED,1) })
            assertEquals(1,results.count { it.isSuccess },results.toString())
            val failure=results.single { it.isFailure }.exceptionOrNull() as ApiException
            assertTrue(failure.code in setOf("ADMIN_REQUIRED","UNAUTHENTICATED","LAST_ADMIN_REQUIRED"),failure.code)
            assertEquals(1,activeAdmins())
        }
    }
    @Test @Order(4) fun `revocation waits for guarded business work and ordinary identity survives qualification removal`() {
        val target=fixture(true);val held=CountDownLatch(1);val release=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val work=pool.submit { tx.required {
                val actor=guards.actor(target.auth,clock.instant())
                assertTrue(access.hasAdminQualificationInTransaction(actor));held.countDown()
                check(release.await(10,TimeUnit.SECONDS));jdbc.update("INSERT INTO admin_test_effect VALUES (?)",UUID.randomUUID())
                val proof=access.accountActorInTransaction(actor)
                access.appendAuditInTransaction(listOf(AuditFact(AuditSource.CONTENT,UUID.randomUUID(),proof.actor,AuditAction.CONTENT_CHANGED,AuditTarget.SUBJECT,UUID.randomUUID())),listOf(proof),UUID.randomUUID(),clock.instant())
            } }
            assertTrue(held.await(10,TimeUnit.SECONDS))
            val revoke=pool.submit<QualificationChangeReceipt> { qualify(base,target.id,false,1) }
            assertThrows(TimeoutException::class.java) { revoke.get(200,TimeUnit.MILLISECONDS) }
            release.countDown();work.get(10,TimeUnit.SECONDS);assertTrue(revoke.get(10,TimeUnit.SECONDS).changed)
            error("ADMIN_REQUIRED") { service.readPolicy(target.auth,UUID.randomUUID()) }
            assertEquals(target.id,guards.authenticate(target.token,clock.instant()).accountId)
            assertEquals(1,count("admin_test_effect"))
        } finally { release.countDown();pool.shutdownNow() }
    }
    @Test @Order(5) fun `audit insertion failures roll back qualification account status credential epoch receipts and reads`() {
        val target=fixture()
        failAudit(AuditAction.ADMIN_QUALIFICATION_CHANGED) {
            error("AUDIT_UNAVAILABLE") { qualify(base,target.id,true,null) }
        }
        assertEquals(0,count("admin_qualification","account_id=?",target.id))
        assertEquals(0,count("admin_command_receipt","target_account_id=?",target.id))
        failAudit(AuditAction.ACCOUNT_STATUS_CHANGED) {
            error("AUDIT_UNAVAILABLE") { status(base,target.id,AccountStatus.DISABLED,1) }
        }
        assertEquals(1,accountVersion(target.id));assertEquals(1,jdbc.queryForObject("SELECT credential_version FROM identity_account WHERE id=?",Long::class.java,target.id)!!)
        assertEquals(target.id,guards.authenticate(target.token,clock.instant()).accountId)
        assertEquals(0,count("admin_command_receipt","target_account_id=?",target.id))
        failAudit(AuditAction.ADMIN_METADATA_READ) {
            error("AUDIT_UNAVAILABLE") { service.getUser(base.auth,target.id,UUID.randomUUID()) }
            val failure=expect(call(HttpMethod.GET,"/security-policy"),503)
            assertEquals("AUDIT_UNAVAILABLE",failure["code"].asText());assertFalse(failure.has("policyVersion"))
        }
        failAudit(AuditAction.AUDIT_READ) { error("AUDIT_UNAVAILABLE") { service.listAudit(base.auth,AuditFilters(clock.instant().minusSeconds(60),clock.instant()),PageSpec(),UUID.randomUUID()) } }
        assertTrue(status(base,target.id,AccountStatus.DISABLED,1).changed)
        error("UNAUTHENTICATED") { guards.authenticate(target.token,clock.instant()) }
        assertFalse(service.getUser(base.auth,target.id,UUID.randomUUID()).adminEligible)
        assertTrue(status(base,target.id,AccountStatus.ACTIVE,2).changed)
        error("UNAUTHENTICATED") { guards.authenticate(target.token,clock.instant()) }
        assertFalse(status(base,target.id,AccountStatus.ACTIVE,3).changed)
    }
    private fun call(method: HttpMethod,path: String,body: String?=null,user: User?=base,key: UUID?=null,requestId: UUID?=UUID.randomUUID()): ResponseEntity<String> {
        val headers=HttpHeaders().apply {
            accept=listOf(MediaType.APPLICATION_JSON);if(body!=null) contentType=MediaType.APPLICATION_JSON
            user?.let { setBearerAuth(it.token) };key?.let { set("Idempotency-Key",it.toString()) };requestId?.let { set("X-Request-Id",it.toString()) }
        }
        val response=http.exchange("/api/v1/admin$path",method,HttpEntity(body,headers),String::class.java)
        val route="/admin"+path.substringBefore('?')
        val operation=contract["paths"].properties().firstOrNull { it.key.replace(Regex("\\{[^}]+}"),"[^/]+").toRegex().matches(route) }?.value?.get(method.name().lowercase())
        if(operation!=null) {
            val rawHeaders=listOf("X-Request-Id","Cache-Control","Content-Type").associateWith { response.headers[it].orEmpty() }
            evidence+=mapOf("operationId" to operation["operationId"].asText(),"method" to method.name(),"path" to "/api/v1/admin$path","status" to response.statusCode.value(),
                "rawResponseHeaders" to rawHeaders,"responseHeaders" to rawHeaders.mapValues { it.value.joinToString(",") },
                "responseBody" to mapper.readTree(response.body),"validateRequest" to false)
        }
        if(requestId!=null) assertEquals(listOf(requestId.toString()),response.headers["X-Request-Id"])
        return response
    }
    private fun expect(response: ResponseEntity<String>,status: Int): JsonNode {
        assertEquals(status,response.statusCode.value(),response.body)
        assertEquals(listOf("no-store"),response.headers["Cache-Control"])
        val requestId=response.headers["X-Request-Id"]!!.single()
        assertEquals(UUID.fromString(requestId).toString(),requestId)
        val json=mapper.readTree(response.body)
        if(status>=400) {
            assertTrue(json.has("code") && json.has("message") && json.has("fieldErrors"));assertEquals(response.headers.getFirst("X-Request-Id"),json["requestId"].asText())
        }
        return json
    }
    @Test @Order(6) fun `all eight HTTP operations use real bearer guards exact response shapes minimal audit and bounded projection`() {
        val target=fixture();val id=target.id
        val qualification=expect(call(HttpMethod.PUT,"/administrators/$id/qualification","""{"qualified":true,"expectedVersion":null}""",key=UUID.randomUUID()),200)
        assertEquals(setOf("accountId","qualified","version","changed","appliedAt"),qualification.fieldNames().asSequence().toSet())
        val admins=expect(call(HttpMethod.GET,"/administrators"),200)
        assertEquals(2,admins["totalItems"].asInt());assertEquals(2,admins["items"].size())
        val empty=expect(call(HttpMethod.GET,"/administrators?page=99&pageSize=1"),200)
        assertEquals(2,empty["totalItems"].asInt());assertTrue(empty["items"].isEmpty)
        val users=expect(call(HttpMethod.GET,"/users?nicknameContains=_&pageSize=100"),200)
        assertTrue(users["items"].any { it["accountId"].asText()==id.toString() })
        assertTrue(service.listUsers(base.auth,AccountFilters(nicknameContains="%_"),PageSpec(1,100),UUID.randomUUID()).items.any { it.accountId==id })
        val requestId=UUID.randomUUID()
        val user=expect(call(HttpMethod.GET,"/users/$id",requestId=requestId),200)
        assertEquals(setOf("accountId","accountCode","nickname","status","maskedEmail","createdAt","accountVersion","adminEligible","membership"),user.fieldNames().asSequence().toSet())
        assertTrue(user["membership"].isNull);assertTrue(user["adminEligible"].asBoolean())
        assertFalse(user.toString().contains(target.email));assertFalse(user.toString().contains("password"))
        assertEquals(1,count("admin_audit_entry","request_id=? AND action='ADMIN_METADATA_READ'",requestId))
        val status=expect(call(HttpMethod.PUT,"/users/$id/status","""{"status":"DISABLED","expectedVersion":1}""",key=UUID.randomUUID()),200)
        assertEquals(setOf("accountId","status","accountVersion","changed","appliedAt"),status.fieldNames().asSequence().toSet())
        assertEquals("DISABLED",expect(call(HttpMethod.GET,"/users/$id"),200)["status"].asText())
        val policy=expect(call(HttpMethod.GET,"/security-policy"),200)
        assertEquals("MVP-1",policy["policyVersion"].asText());assertEquals(1,policy["minimumActiveAdministrators"].asInt())
        val logs=expect(call(HttpMethod.GET,"/audit-logs?sourceModule=ADMIN_SECURITY&action=ACCOUNT_STATUS_CHANGED&targetType=ACCOUNT&targetId=$id"),200)
        assertEquals(1,logs["totalItems"].asInt())
        val detail=expect(call(HttpMethod.GET,"/audit-logs/${logs["items"][0]["id"].asText()}"),200)
        assertEquals(3,detail["changes"].size());assertTrue(detail["reasonCode"].isNull);assertTrue(detail["relatedRecordId"].isNull)
        assertFalse(detail.toString().contains(target.email));assertFalse(detail.toString().contains("password"))
        assertEquals("NOT_FOUND",expect(call(HttpMethod.GET,"/audit-logs/${UUID.randomUUID()}"),404)["code"].asText())
    }
    @Test @Order(7) fun `HTTP rejects unauthorized actors unknown or duplicate fields absent nullable versions invalid keys and unbounded query`() {
        val user=fixture();val id=user.id;val path="/administrators/$id/qualification"
        assertEquals("LAST_ADMIN_REQUIRED",expect(call(HttpMethod.PUT,"/administrators/${base.id}/qualification","""{"qualified":false,"expectedVersion":${qualificationVersion(base.id)}}""",key=UUID.randomUUID()),409)["code"].asText())
        expect(call(HttpMethod.GET,"/security-policy",user=null),401)
        expect(call(HttpMethod.GET,"/security-policy",user=user),403)
        expect(call(HttpMethod.GET,"/users/${UUID.randomUUID()}",user=user),403)
        expect(call(HttpMethod.PUT,"/users/${UUID.randomUUID()}/status","""{"status":"DISABLED","expectedVersion":1}""",user,UUID.randomUUID()),403)
        expect(call(HttpMethod.GET,"/users/${UUID.randomUUID()}"),404)
        for(body in listOf("""{"qualified":true}""","""{"qualified":null,"expectedVersion":null}""","""{"qualified":true,"expectedVersion":null,"email":"x"}""","""{"qualified":true,"qualified":false,"expectedVersion":null}""")) {
            expect(call(HttpMethod.PUT,path,body,key=UUID.randomUUID()),400)
        }
        expect(call(HttpMethod.PUT,path,"""{"qualified":true,"expectedVersion":null}"""),400)
        expect(call(HttpMethod.PUT,"/users/$id/status","""{"status":"DISABLED","expectedVersion":0}""",key=UUID.randomUUID()),422)
        for(pathToCheck in listOf("/users?unknown=x","/users?page=1&page=2","/administrators?qualified=1","/users/1-1-1-1-1","/security-policy?password=x")) expect(call(HttpMethod.GET,pathToCheck),400)
        expect(call(HttpMethod.GET,"/users?pageSize=101"),422)
        expect(call(HttpMethod.PUT,path,"""{"qualified":true,"expectedVersion":null}"""+" ".repeat(16384),key=UUID.randomUUID()),413)
        expect(call(HttpMethod.GET,"/audit-logs?actorAccountId=1-1-1-1-1"),400)
        expect(call(HttpMethod.GET,"/audit-logs?targetId=$id"),422)
        expect(call(HttpMethod.GET,"/audit-logs?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z"),422)
        val body="""{"qualified":true,"expectedVersion":null}""";val key=UUID.randomUUID()
        val granted=expect(call(HttpMethod.PUT,path,body,key=key),200)
        assertEquals(granted,expect(call(HttpMethod.PUT,path,body,key=key),200))
        assertEquals("IDEMPOTENCY_CONFLICT",expect(call(HttpMethod.PUT,path,"$body ",key=key),409)["code"].asText())
        assertEquals("VERSION_CONFLICT",expect(call(HttpMethod.PUT,path,body,key=UUID.randomUUID()),409)["code"].asText())
        status(base,id,AccountStatus.DISABLED,1)
        expect(call(HttpMethod.PUT,path,"""{"qualified":true,"expectedVersion":1}""",key=UUID.randomUUID()),422)
    }
    @Test @Order(8) fun `canonical audits are immutable idempotent proof bound allowlisted and maintenance generation bound`() {
        val eventId=UUID.randomUUID();val target=UUID.randomUUID()
        fun append(changes: List<AuditChange>): UUID=tx.required {
            val actor=guards.actor(base.auth,clock.instant());val proof=access.accountActorInTransaction(actor)
            access.appendAuditInTransaction(listOf(AuditFact(AuditSource.CONTENT,eventId,proof.actor,AuditAction.CONTENT_CHANGED,AuditTarget.SUBJECT,target,changes=changes)),listOf(proof),UUID.randomUUID(),clock.instant()).auditEntryIds.single()
        }
        val changes=listOf(AuditChange(AuditField.RESOURCE_VERSION,"1","2"))
        val id=append(changes);assertEquals(id,append(changes))
        error("AUDIT_EVENT_CONFLICT") { append(listOf(AuditChange(AuditField.RESOURCE_VERSION,"1","3"))) }
        assertThrows(IllegalArgumentException::class.java) { append(listOf(AuditChange(AuditField.RESOURCE_STATUS,"ACTIVE","private body"))) }
        assertThrows(DataAccessException::class.java) { jdbc.update("DELETE FROM admin_audit_entry WHERE id=?",id) }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE admin_audit_entry SET request_id=? WHERE id=?",UUID.randomUUID(),id) }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE admin_audit_change SET after_value='3' WHERE audit_entry_id=?",id) }
        val escaped=tx.required { access.accountActorInTransaction(guards.actor(base.auth,clock.instant())) }
        assertThrows(IllegalStateException::class.java) { tx.required { access.appendAuditInTransaction(listOf(AuditFact(AuditSource.CONTENT,UUID.randomUUID(),escaped.actor,AuditAction.CONTENT_CHANGED,AuditTarget.SUBJECT,target)),listOf(escaped),UUID.randomUUID(),clock.instant()) } }
        for(action in listOf(AuditAction.ANALYTICS_REBUILD_STARTED,AuditAction.ANALYTICS_REBUILD_ACTIVATED,AuditAction.ANALYTICS_REBUILD_FAILED)) tx.required {
            val proof=access.maintenanceActorInTransaction(LocalOperatorProof("ANALYTICS_REBUILD",UUID.randomUUID()),target)
            val fact=AuditFact(AuditSource.ANALYTICS,UUID.randomUUID(),proof.actor,action,AuditTarget.ANALYTICS_GENERATION,target,outcome=if(action==AuditAction.ANALYTICS_REBUILD_FAILED) AuditOutcome.FAILURE else AuditOutcome.SUCCESS,reasonCode=if(action==AuditAction.ANALYTICS_REBUILD_FAILED) "REBUILD_STORAGE_FAILURE" else null)
            assertEquals(1,access.appendAuditInTransaction(listOf(fact),listOf(proof),UUID.randomUUID(),clock.instant()).auditEntryIds.size)
        }
        assertThrows(IllegalStateException::class.java) { tx.required {
            val proof=access.maintenanceActorInTransaction(LocalOperatorProof("ANALYTICS_REBUILD",UUID.randomUUID()),target)
            access.appendAuditInTransaction(listOf(AuditFact(AuditSource.ANALYTICS,UUID.randomUUID(),proof.actor,AuditAction.ANALYTICS_REBUILD_STARTED,AuditTarget.ANALYTICS_GENERATION,UUID.randomUUID())),listOf(proof),UUID.randomUUID(),clock.instant())
        } }
        assertThrows(DataAccessException::class.java) { jdbc.update("INSERT INTO admin_qualification(account_id,qualified,granted_at,created_at,updated_at) VALUES (?,true,?,?,?)",UUID.randomUUID(),now(),now(),now()) }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE admin_qualification SET version=0 WHERE account_id=?",base.id) }
        assertThrows(DataAccessException::class.java) { jdbc.update("INSERT INTO admin_command_receipt SELECT gen_random_uuid(),actor_account_id,operation,command_request_id,target_account_id,payload_digest,digest_key_version,qualified_after,account_status_after,resulting_version,changed,applied_at FROM admin_command_receipt LIMIT 1") }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE admin_command_receipt SET qualified_after=NULL WHERE operation='SET_QUALIFICATION'") }
    }
    @Test @Order(9) fun `Q04 adapter consumes Q03 existing guards and count proof never authorizes a status mutation`() {
        tx.required {
            val accounts=guards.lockAccountsInTransaction(listOf(AccountLock(base.id)))
            val sessions=guards.lockSessionsInTransaction(listOf(SessionLock(base.auth.sessionId)))
            val actor=guards.requireActiveForWrite(base.auth,accounts,sessions,clock.instant())
            val held=AuthorizationIdentityGuards(actor,accounts,guards)
            val admin=authorizationAdapter.requireAdminInTransaction(AuthorizationActor(base.id,base.auth.sessionId),held)
            assertEquals(base.id,admin.actorAccountId);admin.assertCurrentTransaction()
        }
        assertThrows(IllegalStateException::class.java) { tx.required {
            val accounts=guards.lockAccountsInTransaction(listOf(AccountLock(base.id,LockMode.UPDATE)))
            val sessions=guards.lockSessionsInTransaction(listOf(SessionLock(base.auth.sessionId)))
            val actor=guards.requireActiveForWrite(base.auth,accounts,sessions,clock.instant())
            val mutation=access.lockAdminMutationInTransaction(accounts)
            val qualification=access.lockQualificationsInTransaction(accounts,mapOf(base.id to LockMode.UPDATE),mutation).getValue(base.id)
            val admin=access.requireAdminInTransaction(actor,actor.account,qualification)
            assertEquals(1,identity.countActiveAccountsInTransaction(access.qualifiedScope(admin,mutation),admin,mutation))
            identity.setAccountStatus(mutation,base.id,AccountStatus.DISABLED,1,clock.instant())
        } }
    }
    @Test @Order(10) fun `real Q03 registration and Q04 organizations membership share one canonical audit transaction`() {
        val name="测试学院-${UUID.randomUUID()}"
        failAudit(AuditAction.ORGANIZATION_CHANGED) {
            expect(call(HttpMethod.POST,"/colleges","""{"name":"$name","status":"ACTIVE"}""",key=UUID.randomUUID()),503)
        }
        assertEquals(0,count("authz_college","name=?",name))
        val college=expect(call(HttpMethod.POST,"/colleges","""{"name":"$name","status":"ACTIVE"}""",key=UUID.randomUUID()),201)["resourceId"].asText()
        val major=expect(call(HttpMethod.POST,"/colleges/$college/majors","""{"name":"测试专业","status":"ACTIVE"}""",key=UUID.randomUUID()),201)["resourceId"].asText()
        expect(call(HttpMethod.PUT,"/accounts/${base.id}/membership","""{"collegeId":"$college","majorId":"$major","expectedVersion":null}""",key=UUID.randomUUID()),200)
        assertEquals(name,expect(call(HttpMethod.GET,"/users/${base.id}"),200)["membership"]["collegeName"].asText())
        val email="registered-${UUID.randomUUID()}@example.com"
        val challenge=identity.requestPublicEmailChallenge("REGISTER",email,"registration-${UUID.randomUUID()}",UUID.randomUUID())
        val requestId=UUID.randomUUID()
        val body=mapper.writeValueAsBytes(mapOf("challengeId" to challenge.challengeId,"code" to mail.codes.getValue(challenge.challengeId),"password" to password,"nickname" to "新同学","collegeId" to college,"majorId" to major))
        val command=IdentityCommand("identityRegisterEmail",UUID.randomUUID(),requestId,"POST","/api/v1/auth/email-registrations","application/json",body)
        fun register()=identity.registerEmail(challenge.challengeId,mail.codes.getValue(challenge.challengeId),password,"新同学",UUID.fromString(college),UUID.fromString(major),command)
        failAudit(AuditAction.ACCOUNT_REGISTERED) { error("AUDIT_UNAVAILABLE") { register() } }
        assertEquals(0,count("identity_email","email_key=?",email))
        assertNull(jdbc.queryForMap("SELECT consumed_at FROM identity_email_challenge WHERE id=?",challenge.challengeId)["consumed_at"])
        val registration=register();assertEquals(registration,register())
        assertEquals(2,count("admin_audit_entry","request_id=?",requestId))
        assertEquals(1,count("admin_audit_entry","request_id=? AND action='ACCOUNT_REGISTERED'",requestId))
        assertEquals(1,count("admin_audit_entry","request_id=? AND action='MEMBERSHIP_CHANGED'",requestId))
        val membershipEvent=jdbc.queryForObject("SELECT change_id FROM authz_membership_change WHERE account_id=? AND reason='REGISTRATION'",UUID::class.java,registration.accountId)!!
        assertEquals(1,count("admin_audit_entry","source_module='AUTHORIZATION' AND event_id=? AND action='MEMBERSHIP_CHANGED'",membershipEvent))
        assertEquals(1,count("admin_audit_change c JOIN admin_audit_entry e ON e.id=c.audit_entry_id","e.event_id=? AND c.field='RESOURCE_VERSION' AND c.before_value IS NULL AND c.after_value='1'",membershipEvent))
        val view=service.getUser(base.auth,registration.accountId,UUID.randomUUID())
        assertEquals(UUID.fromString(major),view.membership!!.majorId);assertFalse(view.adminEligible)
    }
    @Test @Order(11) fun `terminal audit concurrent replay returns original ID and learning query reads carry no answers`() {
        val eventId=UUID.randomUUID();val target=UUID.randomUUID();val record=UUID.randomUUID()
        fun append()=tx.required {
            val actor=guards.actor(base.auth,clock.instant());val proof=access.accountActorInTransaction(actor)
            access.appendAuditInTransaction(listOf(AuditFact(AuditSource.PRACTICE,eventId,proof.actor,AuditAction.PRACTICE_COMPLETED,AuditTarget.PRACTICE_SESSION,target,AuditRecordKind.COMPLETED,record)),listOf(proof),UUID.randomUUID(),clock.instant()).auditEntryIds.single()
        }
        val results=parallel({ append() },{ append() });assertTrue(results.all { it.isSuccess });assertEquals(results[0].getOrThrow(),results[1].getOrThrow())
        assertEquals(1,count("admin_audit_entry","source_module='PRACTICE' AND event_id=?",eventId))
        tx.required {
            val actor=guards.actor(base.auth,clock.instant());val proof=access.accountActorInTransaction(actor)
            access.appendAuditInTransaction(listOf(AuditFact(AuditSource.LEARNING,UUID.randomUUID(),proof.actor,AuditAction.STUDENT_RECORDS_READ,AuditTarget.QUERY,null)),listOf(proof),UUID.randomUUID(),clock.instant())
        }
    }
    @Test @Order(12) fun `real HTTP success emits one supplied or generated request ID and one no-store header`() {
        for(supplied in listOf(UUID.randomUUID(),null)) {
            val response=call(HttpMethod.GET,"/users?pageSize=1",requestId=supplied)
            expect(response,200)
            val id=UUID.fromString(response.headers["X-Request-Id"]!!.single())
            if(supplied!=null) assertEquals(supplied,id)
            assertEquals(1,count("admin_audit_entry","request_id=? AND action='ADMIN_METADATA_READ'",id))
        }
        expect(call(HttpMethod.GET,"/users",user=null,requestId=null),401)
    }
}
