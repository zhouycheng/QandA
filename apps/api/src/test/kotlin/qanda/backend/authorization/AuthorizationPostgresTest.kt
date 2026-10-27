package qanda.backend.authorization

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.support.StaticListableBeanFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.authorization.api.*
import qanda.backend.platform.http.*
import qanda.backend.platform.security.CommandDigests
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.UUID
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean

@Tag("postgres")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthorizationPostgresTest {
    private class IsolatedPostgres:PostgreSQLContainer<IsolatedPostgres>("postgres:17.6-alpine")
    private val postgres=IsolatedPostgres().withDatabaseName("qanda_backend")
    private lateinit var jdbc:JdbcTemplate
    private lateinit var tx:JdbcTransactions
    private lateinit var store:AuthorizationStore
    private lateinit var service:AuthorizationService
    private lateinit var mvc:MockMvc
    private val mapper=ObjectMapper().registerKotlinModule().registerModule(JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
    private val current=ThreadLocal<AuthorizationActor>()
    private lateinit var admin:UUID
    private lateinit var learner:UUID
    private lateinit var outsider:UUID
    private lateinit var college:UUID
    private lateinit var otherCollege:UUID
    private lateinit var major:UUID
    private lateinit var otherMajor:UUID
    private lateinit var school:UUID
    private lateinit var userSubject:UUID
    private val failAudit=AtomicBoolean(false)
    private val metadata=ConcurrentHashMap<UUID,SubjectAccessDescriptor>()
    private val codeById=ConcurrentHashMap<UUID,String>()
    private val time=Instant.parse("2026-10-26T05:00:00Z")
    private lateinit var identity:AuthorizationIdentityPort
    private lateinit var adminPort:AuthorizationAdminPort
    private lateinit var contentPort:AuthorizationContentPort

    @BeforeAll fun start() {
        postgres.start()
        val source=DriverManagerDataSource(postgres.jdbcUrl,postgres.username,postgres.password)
        jdbc=JdbcTemplate(source);tx=JdbcTransactions(DataSourceTransactionManager(source));store=AuthorizationStore(jdbc)
        Flyway.configure().dataSource(source).locations("classpath:db/migration/platform","classpath:db/migration/identity","classpath:db/migration/authorization").target("1450").cleanDisabled(true).load().migrate()
        assertEquals("qanda_backend",jdbc.queryForObject("SELECT current_database()",String::class.java))
        jdbc.execute("CREATE TABLE authz_test_audit(event_id uuid PRIMARY KEY,action text NOT NULL)")
        identity=object:AuthorizationIdentityPort {
            override fun currentActor():AuthorizationActor=current.get() ?: throw ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请登录")
            override fun lockAccountsAndSessionInTransaction(actor:AuthorizationActor,modes:Map<UUID,GuardMode>):AuthorizationAccountGuards {
                assertEquals(currentActor(),actor)
                val token=store.connection()
                val active=modes.toSortedMap(compareBy(UUID::toString)).mapValues { (id,mode) ->
                    jdbc.queryForList("SELECT status FROM identity_account WHERE id=? FOR ${if(mode==GuardMode.UPDATE)"UPDATE" else "SHARE"}",id).singleOrNull()?.get("status")=="ACTIVE"
                }
                if(!active.getValue(actor.accountId))throw ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请登录")
                return object:AuthorizationAccountGuards {
                    override fun assertHeld(accountId:UUID,mode:GuardMode) { store.assertConnection(token);check(accountId in modes && (mode==GuardMode.SHARE || modes[accountId]==GuardMode.UPDATE)) }
                    override fun isActive(accountId:UUID):Boolean { assertHeld(accountId);return active.getValue(accountId) }
                }
            }
            override fun resolveRecipient(accountCode:String):Recipient {
                val id=codeById.entries.singleOrNull { it.value==accountCode }?.key ?: missing()
                if(jdbc.queryForObject("SELECT status FROM identity_account WHERE id=?",String::class.java,id)!="ACTIVE")missing()
                return Recipient(id,accountCode,"测试昵称")
            }
            override fun readRecipientSummariesForOwnedShares(accountIds:List<UUID>,proof:OwnedShareReadProof):List<Recipient> {
                service.validateOwnedShareReadProofInTransaction(proof,accountIds)
                return accountIds.map { Recipient(it,codeById.getValue(it),"测试昵称") }
            }
        }
        adminPort=object:AuthorizationAdminPort {
            override fun requireAdminInTransaction(actor:AuthorizationActor,accountGuards:AuthorizationAccountGuards):AuthorizationAdminContext {
                accountGuards.assertHeld(actor.accountId)
                if(actor.accountId!=admin)throw ApiException(HttpStatus.FORBIDDEN,"ADMIN_REQUIRED","需要管理资格")
                val token=store.connection()
                return object:AuthorizationAdminContext { override val actorAccountId=actor.accountId;override fun assertCurrentTransaction()=store.assertConnection(token) }
            }
            override fun appendAuditInTransaction(facts:List<AuthorizationAuditFact>,requestId:UUID,now:Instant) {
                facts.forEach { jdbc.update("INSERT INTO authz_test_audit VALUES(?,?) ON CONFLICT DO NOTHING",it.eventId,it.action) }
                if(failAudit.get())throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"AUDIT_UNAVAILABLE","审计暂不可用")
            }
        }
        contentPort=object:AuthorizationContentPort {
            override fun lockSubjectInTransaction(subjectId:UUID,mode:GuardMode):AuthorizationSubjectGuard {
                if(!metadata.containsKey(subjectId))missing()
                jdbc.queryForList("SELECT subject_id FROM authz_subject_policy WHERE subject_id=? FOR ${if(mode==GuardMode.UPDATE)"UPDATE" else "SHARE"}",subjectId)
                val token=store.connection()
                return object:AuthorizationSubjectGuard { override val subjectId=subjectId;override fun assertHeld(modeRequired:GuardMode) { store.assertConnection(token);check(modeRequired==GuardMode.SHARE || mode==GuardMode.UPDATE) } }
            }
            override fun describeLocked(guard:AuthorizationSubjectGuard):SubjectAccessDescriptor { guard.assertHeld();return metadata.getValue(guard.subjectId) }
            override fun readSchoolMetadataInTransaction(page:Int,pageSize:Int):Page<Pair<SubjectAccessDescriptor,String>> {
                val all=metadata.values.filter { it.source==SubjectSource.SCHOOL }.sortedBy { it.id.toString() }
                return Page(all.drop((page-1)*pageSize).take(pageSize).map { it to "共享科目" },page,pageSize,all.size.toLong())
            }
        }
        val beans=StaticListableBeanFactory(mapOf("identity" to identity,"admin" to adminPort,"content" to contentPort))
        service=AuthorizationService(store,tx,AuthorizationCommands(store,CommandDigests(1,mapOf(1 to ByteArray(32){7}))),Clock.fixed(time,java.time.ZoneOffset.UTC),beans.getBeanProvider(AuthorizationIdentityPort::class.java),beans.getBeanProvider(AuthorizationAdminPort::class.java),beans.getBeanProvider(AuthorizationContentPort::class.java),object:AuthorizationContentReadiness { override fun requireReadyInTransaction()=Unit })
        val errors=ErrorWriter(mapper)
        mvc=MockMvcBuilders.standaloneSetup(AuthorizationController(service)).setControllerAdvice(ApiExceptionHandler()).setMessageConverters(MappingJackson2HttpMessageConverter(mapper)).addFilters<org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder>(RequestIdFilter(errors),JsonBodyFilter(errors)).build()
    }
    @AfterAll fun stop() { postgres.stop() }
    @BeforeEach fun seed() {
        // This container is created and owned by this test; no shared database is addressed.
        for(table in listOf("authz_test_audit","authz_command_receipt","authz_membership_change","authz_membership","authz_user_share","authz_account_rule","authz_college_grant","authz_major_grant","authz_subject_policy","authz_major","authz_college","identity_account"))jdbc.update("DELETE FROM $table")
        metadata.clear();codeById.clear();failAudit.set(false)
        admin=account("QA0000000001");learner=account("QA0000000002");outsider=account("QA0000000003");asActor(admin)
        college=UUID.randomUUID();otherCollege=UUID.randomUUID();major=UUID.randomUUID();otherMajor=UUID.randomUUID()
        store.insertCollege(college,"学院甲",OrganizationStatus.ACTIVE,time);store.insertCollege(otherCollege,"学院乙",OrganizationStatus.ACTIVE,time)
        store.insertMajor(major,college,"专业甲",OrganizationStatus.ACTIVE,time);store.insertMajor(otherMajor,otherCollege,"专业乙",OrganizationStatus.ACTIVE,time)
        tx.required { store.changeMembership(admin,major,null,admin,"REGISTRATION",time);store.changeMembership(learner,major,null,learner,"REGISTRATION",time);Unit }
        school=subject(SubjectSource.SCHOOL);userSubject=subject(SubjectSource.USER)
    }
    private fun account(code:String):UUID {
        val id=UUID.randomUUID();jdbc.update("INSERT INTO identity_account VALUES(?,?,?,'ACTIVE',1,1,?,?)",id,code,"测试昵称",time.sql(),time.sql());codeById[id]=code;return id
    }
    private fun subject(source:SubjectSource):UUID {
        val id=UUID.randomUUID();metadata[id]=SubjectAccessDescriptor(id,source,admin.takeIf { source==SubjectSource.USER },"ACTIVE",true,true,true,1)
        tx.required { jdbc.update("INSERT INTO authz_subject_policy VALUES(?,false,1,?,?)",id,time.sql(),time.sql());Unit }
        return id
    }
    private fun asActor(id:UUID) { current.set(AuthorizationActor(id,UUID(0,1))) }
    private fun command(operation:String="test",key:UUID=UUID.randomUUID(),body:String="{}"):AuthorizationCommand=AuthorizationCommand(key,UUID.randomUUID(),"PUT","/api/v1/test/$operation","application/json",body.toByteArray())
    private fun policyVersion(id:UUID)=tx.required { store.policy(id).version }
    private fun verdict(id:UUID,actorId:UUID=learner,action:AccessAction=AccessAction.CREATE):AccessVerdict {
        asActor(actorId)
        return tx.required {
            val actor=identity.currentActor();val accounts=identity.lockAccountsAndSessionInTransaction(actor,mapOf(actorId to GuardMode.SHARE));val org=service.prepareAccessInTransaction(actor,accounts)
            val guard=contentPort.lockSubjectInTransaction(id,GuardMode.SHARE)
            service.evaluateLocked(actor,accounts,org,guard,contentPort.describeLocked(guard),action)
        }
    }

    @Test fun `real constraints reject invalid parents duplicate names empty rules and dangling account IDs`() {
        assertThrows(DataIntegrityViolationException::class.java) { store.insertMajor(UUID.randomUUID(),UUID.randomUUID(),"不存在",OrganizationStatus.ACTIVE,time) }
        assertThrows(DataIntegrityViolationException::class.java) { store.insertCollege(UUID.randomUUID(),"学院甲",OrganizationStatus.ACTIVE,time) }
        assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO authz_membership VALUES(?,?,1,?,?)",UUID.randomUUID(),major,time.sql(),time.sql()) }
        assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO authz_account_rule VALUES(?,?,false,false,?,?)",school,learner,admin,time.sql()) }
        assertEquals(9,jdbc.queryForObject("SELECT count(*)::int FROM pg_constraint WHERE conname LIKE 'authz_%' AND confrelid='identity_account'::regclass",Int::class.java))
        assertThrows(ApiException::class.java) { tx.required { AuthorizationContentGate(jdbc).requireReadyInTransaction();Unit } }.also { assertEquals("CONTENT_INTEGRATION_NOT_READY",it.code) }
    }
    @Test fun `SQL scope and locked evaluation agree for all 32 combinations without private privilege bleed`() {
        for(mask in 0..31) {
            val p=mask and 1!=0;val g=mask and 2!=0;val c=mask and 4!=0;val m=mask and 8!=0;val b=mask and 16!=0
            jdbc.update("UPDATE authz_subject_policy SET is_public=? WHERE subject_id=?",p,school)
            jdbc.update("DELETE FROM authz_college_grant");jdbc.update("DELETE FROM authz_major_grant");jdbc.update("DELETE FROM authz_account_rule")
            if(c)jdbc.update("INSERT INTO authz_college_grant VALUES(?,?,?,?)",school,college,admin,time.sql())
            if(m)jdbc.update("INSERT INTO authz_major_grant VALUES(?,?,?,?)",school,major,admin,time.sql())
            if(g || b)jdbc.update("INSERT INTO authz_account_rule VALUES(?,?,?,?,?,?)",school,learner,g,b,admin,time.sql())
            val expected=p || g || (!b && (c || m))
            assertEquals(expected,verdict(school).allowed,"locked mask=$mask")
            tx.required {
                val actor=identity.currentActor();val held=identity.lockAccountsAndSessionInTransaction(actor,mapOf(learner to GuardMode.SHARE));val org=service.prepareAccessInTransaction(actor,held)
                val scope=service.authorizedScopeForQuery(actor,held,org,AccessAction.CREATE)
                val sql="SELECT count(*) FROM (SELECT ?::uuid id,'SCHOOL'::text source,NULL::uuid owner_account_id,'ACTIVE'::text status) s WHERE ${scope.predicate}"
                assertEquals(if(expected)1L else 0L,jdbc.queryForObject(sql,Long::class.java,*(listOf(school)+scope.parameters).toTypedArray()),"SQL mask=$mask")
            }
        }
        assertFalse(verdict(userSubject,outsider).allowed)
    }
    @Test fun `organization change preserves personal rules and version races commit one winner`() {
        asActor(admin);service.setAccountRule(school,learner,SetSchoolAccountRule(true,true,1),command())
        asActor(learner)
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val futures=(0..1).map { pool.submit<Any> {
                asActor(learner);start.await()
                try { service.setMembership(SetMembership(otherCollege,otherMajor,1),command()) } catch(e:ApiException) { e }
            } }
            start.countDown();val outcomes=futures.map { it.get(15,TimeUnit.SECONDS) }
            assertEquals(1,outcomes.count { it is ChangeReceipt });assertEquals(1,outcomes.count { it is ApiException && it.code=="VERSION_CONFLICT" })
        } finally { pool.shutdownNow() }
        assertEquals(2,jdbc.queryForObject("SELECT version FROM authz_membership WHERE account_id=?",Long::class.java,learner))
        assertEquals(2,jdbc.queryForObject("SELECT count(*)::int FROM authz_membership_change WHERE account_id=?",Int::class.java,learner))
        val rule=store.rule(school,learner)!!;assertTrue(rule.granted);assertTrue(rule.inheritanceBlocked)
        assertTrue(verdict(school).allowed)
    }
    @Test fun `organization disable hides selections and suspends only inherited access while re-enable restores it`() {
        asActor(admin);service.setOrganizationGrant(school,college,true,SetOrganizationGrant(true,1),command())
        service.updateCollege(college,UpdateOrganization("学院甲",OrganizationStatus.DISABLED,1),command())
        assertFalse(service.listColleges(1,20).items.any { it.collegeId==college })
        assertEquals(404,assertThrows(ApiException::class.java) { service.listMajors(college,1,20) }.status.value())
        assertFalse(verdict(school).allowed)
        asActor(admin);service.setAccountRule(school,learner,SetSchoolAccountRule(true,true,2),command())
        assertTrue(verdict(school).allowed)
        asActor(admin);service.updateCollege(college,UpdateOrganization("学院甲",OrganizationStatus.ACTIVE,2),command())
        service.setAccountRule(school,learner,SetSchoolAccountRule(false,false,3),command())
        org.junit.jupiter.api.Assertions.assertNull(store.rule(school,learner));assertTrue(verdict(school).allowed)
        val pastEnd=service.listColleges(999,20);assertTrue(pastEnd.items.isEmpty());assertEquals(2L,pastEnd.totalItems)
        asActor(admin)
        assertEquals("NAME_CONFLICT",assertThrows(ApiException::class.java) { service.createCollege(CreateOrganization("  学院甲  "),command()) }.code)
    }
    @Test fun `audit failure rolls back grant membership history and success receipt`() {
        asActor(admin);val grant=command();failAudit.set(true)
        assertEquals("AUDIT_UNAVAILABLE",assertThrows(ApiException::class.java) { service.setSchoolPublic(school,SetPublic(true,1),grant) }.code)
        assertFalse(tx.required { store.policy(school).isPublic });assertEquals(0,jdbc.queryForObject("SELECT count(*)::int FROM authz_command_receipt",Int::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*)::int FROM authz_test_audit",Int::class.java))
        asActor(learner);val old=store.membership(learner)!!
        assertThrows(ApiException::class.java) { service.setMembership(SetMembership(otherCollege,otherMajor,1),command()) }
        assertEquals(old,store.membership(learner));assertEquals(1,jdbc.queryForObject("SELECT count(*)::int FROM authz_membership_change WHERE account_id=?",Int::class.java,learner))
        failAudit.set(false);asActor(admin);assertTrue(service.setSchoolPublic(school,SetPublic(true,1),grant).changed)
    }
    @Test fun `original success replay does not revive a later revoked share and mismatch conflicts`() {
        asActor(admin);val original=command("share",body="grant")
        val granted=service.grantShare(userSubject,GrantUserShare(codeById.getValue(learner),1),original)
        service.revokeShare(userSubject,RevokeUserShare(learner,2),command("revoke"))
        jdbc.update("UPDATE identity_account SET status='DISABLED' WHERE id=?",learner)
        assertEquals(granted,service.grantShare(userSubject,GrantUserShare(codeById.getValue(learner),1),original))
        jdbc.update("UPDATE identity_account SET status='ACTIVE' WHERE id=?",learner)
        assertFalse(verdict(userSubject).allowed)
        asActor(admin)
        assertEquals("IDEMPOTENCY_CONFLICT",assertThrows(ApiException::class.java) { service.grantShare(userSubject,GrantUserShare(codeById.getValue(learner),1),command("share",original.commandId,"other")) }.code)
        assertEquals(2,jdbc.queryForObject("SELECT count(*)::int FROM authz_test_audit",Int::class.java))
    }
    @Test fun `private share does not grant edit rights and inactive content does not revoke issued access`() {
        asActor(outsider);assertEquals(404,assertThrows(ApiException::class.java) { service.listShares(userSubject,1,20) }.status.value())
        asActor(admin);service.grantShare(userSubject,GrantUserShare(codeById.getValue(learner),1),command())
        assertTrue(verdict(userSubject).allowed);assertFalse(verdict(userSubject,learner,AccessAction.EDIT_USER_CONTENT).allowed)
        metadata[userSubject]=metadata.getValue(userSubject).copy(status="INACTIVE",newSelectionAvailable=false,contentVersion=2)
        assertEquals("NEW_SELECTION_UNAVAILABLE",verdict(userSubject).denialKind)
        assertTrue(verdict(userSubject,learner,AccessAction.CONTINUE_FIXED_SESSION).allowed)
        asActor(admin);service.revokeShare(userSubject,RevokeUserShare(learner,2),command())
        assertEquals("ACCESS_DENIED",verdict(userSubject,learner,AccessAction.CONTINUE_FIXED_SESSION).denialKind)
    }
    @Test fun `bounded membership projection permits null and disabled targets and rejects stale context`() {
        asActor(admin)
        lateinit var proof:AuthorizationAdminContext
        tx.required {
            val actor=identity.currentActor();val held=identity.lockAccountsAndSessionInTransaction(actor,mapOf(admin to GuardMode.SHARE));proof=adminPort.requireAdminInTransaction(actor,held)
            jdbc.update("UPDATE identity_account SET status='DISABLED' WHERE id=?",learner)
            val rows=service.readMembershipSummariesInTransaction(listOf(outsider,learner),proof)
            org.junit.jupiter.api.Assertions.assertNull(rows.first().membership);assertEquals(learner,rows.last().membership!!.accountId)
        }
        assertThrows(ApiException::class.java) { tx.required {
            val actor=identity.currentActor();val held=identity.lockAccountsAndSessionInTransaction(actor,mapOf(admin to GuardMode.SHARE))
            service.readMembershipSummariesInTransaction(List(101){outsider},adminPort.requireAdminInTransaction(actor,held))
        } }
        assertThrows(IllegalStateException::class.java) { tx.required { service.readMembershipSummariesInTransaction(listOf(learner),proof) } }
    }
    @Test fun `registration selection enforces parent and transaction and returns stable history audit identity`() {
        fun proof(id:UUID):RegistrationIdentityProof {
            val token=store.connection()
            return object:RegistrationIdentityProof { override val accountId=id;override fun assertCurrentTransaction()=store.assertConnection(token) }
        }
        val mismatch=assertThrows(ApiException::class.java) { tx.required {
            val id=account("QA0000000004")
            service.prepareMembershipSelectionInTransaction(college,otherMajor,proof(id))
        } }
        assertEquals("MAJOR_COLLEGE_MISMATCH",mismatch.code)
        assertEquals(3,jdbc.queryForObject("SELECT count(*)::int FROM identity_account",Int::class.java))
        lateinit var stale:SelectionGuard
        tx.required { stale=service.prepareMembershipSelectionInTransaction(college,major,proof(outsider));Unit }
        assertThrows(IllegalStateException::class.java) { tx.required { service.initializeMembershipInTransaction(outsider,college,major,outsider,stale,time) } }
        val initialized=tx.required {
            val selection=service.prepareMembershipSelectionInTransaction(college,major,proof(outsider))
            service.initializeMembershipInTransaction(outsider,college,major,outsider,selection,time)
        }
        assertEquals(1L,initialized.version);assertEquals(major,initialized.snapshot.majorId)
        assertEquals(initialized.auditFact.eventId,jdbc.queryForObject("SELECT change_id FROM authz_membership_change WHERE account_id=?",UUID::class.java,outsider))
        assertEquals("1",initialized.auditFact.changes.single { it.field=="RESOURCE_VERSION" }.afterValue)
        assertThrows(ApiException::class.java) { tx.required {
            val selection=service.prepareMembershipSelectionInTransaction(college,major,proof(outsider))
            service.initializeMembershipInTransaction(outsider,college,major,outsider,selection,time)
        } }
        assertEquals(1,jdbc.queryForObject("SELECT count(*)::int FROM authz_membership_change WHERE account_id=?",Int::class.java,outsider))
    }
    @Test fun `concurrent identical commands share one receipt and no-op does not append audit`() {
        val original=command("college",body="{\"name\":\"并发学院\"}")
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val futures=(0..1).map { pool.submit<ChangeReceipt> { asActor(admin);start.await();service.createCollege(CreateOrganization("并发学院"),original) } }
            start.countDown();val receipts=futures.map { it.get(15,TimeUnit.SECONDS) };assertEquals(receipts.first(),receipts.last())
            assertEquals(1,jdbc.queryForObject("SELECT count(*)::int FROM authz_college WHERE name='并发学院'",Int::class.java))
            asActor(admin)
            assertFalse(service.updateCollege(receipts.first().resourceId,UpdateOrganization("并发学院",OrganizationStatus.ACTIVE,1),command()).changed)
            assertEquals(1,jdbc.queryForObject("SELECT count(*)::int FROM authz_test_audit",Int::class.java))
            assertEquals(2,jdbc.queryForObject("SELECT count(*)::int FROM authz_command_receipt",Int::class.java))
        } finally { pool.shutdownNow() }
    }
    @Test fun `all 27 HTTP operations return real module results matching their paths and shapes`() {
        val evidence=mutableListOf<Map<String,Any>>()
        fun call(op:String,method:String,path:String,body:Map<String,Any?>?=null,status:Int=200):JsonNode {
            val raw=body?.let(mapper::writeValueAsBytes)
            val req=when(method){"POST"->post(path);"PUT"->put(path);else->get(path)}
            if(raw!=null)req.contentType("application/json").content(raw).header("Idempotency-Key",UUID.randomUUID())
            val result=mvc.perform(req).andReturn().response
            assertEquals(status,result.status,"$op: ${result.contentAsString}")
            org.junit.jupiter.api.Assertions.assertNotNull(result.getHeader("X-Request-Id"))
            val value=mapper.readTree(result.contentAsByteArray)
            evidence+=mapOf("operationId" to op,"method" to method,"path" to path,"status" to status,"body" to value)
            return value
        }
        call("authorizationListSelectableColleges","GET","/api/v1/colleges")
        call("authorizationListSelectableMajors","GET","/api/v1/colleges/$college/majors")
        call("authorizationAdminListColleges","GET","/api/v1/admin/colleges")
        val newCollege=call("authorizationCreateCollege","POST","/api/v1/admin/colleges",mapOf("name" to "新学院"),201)["resourceId"].asText()
        call("authorizationAdminGetCollege","GET","/api/v1/admin/colleges/$newCollege")
        call("authorizationUpdateCollege","PUT","/api/v1/admin/colleges/$newCollege",mapOf("name" to "新学院甲","status" to "ACTIVE","expectedVersion" to 1))
        call("authorizationAdminListMajors","GET","/api/v1/admin/colleges/$newCollege/majors")
        val newMajor=call("authorizationCreateMajor","POST","/api/v1/admin/colleges/$newCollege/majors",mapOf("name" to "新专业"),201)["resourceId"].asText()
        call("authorizationAdminGetMajor","GET","/api/v1/admin/majors/$newMajor")
        call("authorizationUpdateMajor","PUT","/api/v1/admin/majors/$newMajor",mapOf("name" to "新专业甲","status" to "ACTIVE","expectedVersion" to 1))
        call("authorizationGetOwnMembership","GET","/api/v1/me/membership")
        call("authorizationSetOwnMembership","PUT","/api/v1/me/membership",mapOf("collegeId" to otherCollege,"majorId" to otherMajor,"expectedVersion" to 1))
        call("authorizationAdminGetMembership","GET","/api/v1/admin/accounts/$learner/membership")
        call("authorizationAdminSetMembership","PUT","/api/v1/admin/accounts/$learner/membership",mapOf("collegeId" to otherCollege,"majorId" to otherMajor,"expectedVersion" to 1))
        call("authorizationAdminListMembershipHistory","GET","/api/v1/admin/accounts/$learner/membership-history")
        call("authorizationExplainAccountSchoolAccess","GET","/api/v1/admin/accounts/$learner/school-access")
        call("authorizationGetSchoolPolicy","GET","/api/v1/admin/subjects/$school/school-access")
        call("authorizationSetSchoolPublic","PUT","/api/v1/admin/subjects/$school/school-access",mapOf("isPublic" to true,"expectedVersion" to 1))
        call("authorizationListCollegeGrants","GET","/api/v1/admin/subjects/$school/college-grants")
        call("authorizationSetCollegeGrant","PUT","/api/v1/admin/subjects/$school/college-grants/$college",mapOf("enabled" to true,"expectedVersion" to 2))
        call("authorizationListMajorGrants","GET","/api/v1/admin/subjects/$school/major-grants")
        call("authorizationSetMajorGrant","PUT","/api/v1/admin/subjects/$school/major-grants/$major",mapOf("enabled" to true,"expectedVersion" to 3))
        call("authorizationListSchoolAccountRules","GET","/api/v1/admin/subjects/$school/account-rules")
        call("authorizationSetSchoolAccountRule","PUT","/api/v1/admin/subjects/$school/account-rules/$learner",mapOf("granted" to true,"inheritanceBlocked" to true,"expectedVersion" to 4))
        call("authorizationListUserSubjectShares","GET","/api/v1/subjects/$userSubject/shares")
        call("authorizationGrantUserSubjectShare","POST","/api/v1/subjects/$userSubject/shares",mapOf("accountCode" to codeById.getValue(learner),"expectedVersion" to 1))
        call("authorizationRevokeUserSubjectShare","POST","/api/v1/subjects/$userSubject/share-revocations",mapOf("recipientAccountId" to learner,"expectedVersion" to 2))
        assertEquals(27,evidence.map { it["operationId"] }.distinct().size)
        val output=Path.of("build/reports/authorization-http-evidence.json");Files.createDirectories(output.parent);mapper.writerWithDefaultPrettyPrinter().writeValue(output.toFile(),evidence)
    }
    @Test fun `HTTP trust boundary rejects unknown fields missing explicit null versions and unauthorized admin`() {
        asActor(learner)
        assertEquals(403,mvc.perform(get("/api/v1/admin/colleges")).andReturn().response.status)
        asActor(admin)
        for(body in listOf("{\"collegeId\":\"$college\",\"majorId\":\"$major\"}","{\"collegeId\":\"$college\",\"majorId\":\"$major\",\"expectedVersion\":1,\"accountId\":\"$learner\"}")) {
            assertEquals(400,mvc.perform(put("/api/v1/me/membership").contentType("application/json").header("Idempotency-Key",UUID.randomUUID()).content(body)).andReturn().response.status)
        }
        assertEquals(400,mvc.perform(get("/api/v1/colleges?page=0")).andReturn().response.status)
        for(body in listOf("{\"expectedVersion\":1}","{\"isPublic\":null,\"expectedVersion\":1}","{\"isPublic\":true}")) {
            assertEquals(400,mvc.perform(put("/api/v1/admin/subjects/$school/school-access").contentType("application/json").header("Idempotency-Key",UUID.randomUUID()).content(body)).andReturn().response.status)
        }
        assertEquals(400,mvc.perform(post("/api/v1/admin/colleges").contentType("application/json").content("{\"name\":\"缺请求号\"}")).andReturn().response.status)
        assertEquals(415,mvc.perform(post("/api/v1/admin/colleges").contentType("text/plain").header("Idempotency-Key",UUID.randomUUID()).content("name")).andReturn().response.status)
        assertEquals(413,mvc.perform(post("/api/v1/admin/colleges").contentType("application/json").header("Idempotency-Key",UUID.randomUUID()).content("{\"name\":\"大请求\"}"+" ".repeat(16384))).andReturn().response.status)
        assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM authz_command_receipt",Long::class.java)!!)
    }
}
