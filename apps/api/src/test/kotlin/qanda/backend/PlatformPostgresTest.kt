package qanda.backend

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.containers.GenericContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.utility.MountableFile
import qanda.backend.admin.*
import qanda.backend.identity.*
import qanda.backend.platform.mail.*
import java.net.URI
import java.net.http.*
import java.nio.file.Files
import java.nio.file.Path
import java.time.*
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO

@Tag("postgres")
@Testcontainers
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlatformPostgresTest {
    companion object {
        @Container @JvmField val postgres=PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply {
            withDatabaseName("qanda_backend");withUsername("qanda_backend");withPassword("isolated-test-password")
            withCopyFileToContainer(MountableFile.forClasspathResource("db/schema.sql"),"/docker-entrypoint-initdb.d/schema.sql")
        }
        @Container @JvmField val mailpit=GenericContainer<Nothing>("axllent/mailpit:v1.32.0").apply { withExposedPorts(1025,8025) }
        private val assetRoot=Files.createTempDirectory("qanda-v1-assets-")
        private val key=Base64.getEncoder().encodeToString(ByteArray(32) { 13 })
        @JvmStatic @DynamicPropertySource fun properties(r: DynamicPropertyRegistry) {
            postgres.start();mailpit.start()
            r.add("spring.datasource.url") { postgres.jdbcUrl };r.add("spring.datasource.username") { postgres.username };r.add("spring.datasource.password") { postgres.password }
            r.add("qanda.backend.mode") { "test" };r.add("server.address") { "127.0.0.1" }
            r.add("BACKEND_WECHAT_PROVIDER") { "local" };r.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:$key" };r.add("BACKEND_IDENTITY_MAC_KEYS") { "1:$key" };r.add("BACKEND_IDENTITY_RATE_KEY") { key }
            r.add("BACKEND_MAIL_ENCRYPTION_KEYS") { "1:$key" };r.add("qanda.backend.mail.enabled") { true };r.add("qanda.backend.mail.transport") { "local-capture" }
            r.add("qanda.backend.mail.host") { "127.0.0.1" };r.add("qanda.backend.mail.port") { mailpit.getMappedPort(1025) };r.add("qanda.backend.mail.dispatch-enabled") { false }
            r.add("qanda.backend.files.enabled") { true };r.add("qanda.backend.files.root") { assetRoot.toString() }
            r.add("springdoc.api-docs.enabled") { true };r.add("springdoc.swagger-ui.enabled") { true }
            r.add("qanda.backend.request-limits.read-per-account") { 100000 };r.add("qanda.backend.request-limits.write-per-account") { 100000 }
        }
    }
    @LocalServerPort var port: Int=0
    @Autowired lateinit var json: ObjectMapper
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var adminService: AdminService
    @Autowired lateinit var mailCrypto: MailCrypto
    @Autowired lateinit var outbox: OutboxService
    @Autowired lateinit var sessionService: Sessions
    @Autowired lateinit var learningMapper: qanda.backend.learning.LearningMapper
    private val http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val exchanges=java.util.concurrent.ConcurrentLinkedQueue<Map<String,Any?>>()
    private lateinit var adminToken: String
    private lateinit var platformId: UUID
    private val password="Learner-password-123"
    private data class Student(val id: UUID,val email: String,val token: String)
    private data class Fixture(val subject: UUID,val bank: UUID,val questions: List<UUID>)

    @BeforeAll fun bootstrap() {
        platformId=adminService.bootstrap("test_admin","测试管理员","Administrator-password-123")
        adminToken=call("POST","/admin/auth/sessions",mapOf("username" to "test_admin","password" to "Administrator-password-123","deviceId" to UUID.randomUUID()),null)["accessToken"].asText()
        assertEquals(platformId,sessionService.authenticate(adminToken).id)
        learningMapper.days(qanda.backend.learning.StatsFilter(Instant.now().minusSeconds(86400),Instant.now()))
        learningMapper.activityDays(qanda.backend.learning.StatsFilter(Instant.now().minusSeconds(86400),Instant.now()))
    }
    private fun raw(method: String,path: String,body: Any?=null,token: String?=adminToken,key: UUID?=UUID.randomUUID(),contentType: String="application/json",accept: String?=null,extraHeaders: Map<String,String> = emptyMap()): HttpResponse<String> {
        val builder=HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/v1$path")).timeout(Duration.ofSeconds(30))
        token?.let { builder.header("Authorization","Bearer $it") };key?.let { builder.header("Idempotency-Key",it.toString()) }
        if(body!=null) builder.header("Content-Type",contentType)
        accept?.let { builder.header("Accept",it) };extraHeaders.forEach { (name,value) -> builder.header(name,value) }
        val bytes=when(body) { null -> ByteArray(0);is ByteArray -> body;else -> json.writeValueAsBytes(body) }
        val response=http.send(builder.method(method,HttpRequest.BodyPublishers.ofByteArray(bytes)).build(),HttpResponse.BodyHandlers.ofString())
        exchanges.add(mapOf("method" to method,"path" to "/api/v1$path","status" to response.statusCode(),"validateRequest" to (response.statusCode()<400),
            "requestHeaders" to buildMap<String,String> { putAll(extraHeaders);if(body!=null) put("Content-Type",contentType);key?.let { put("Idempotency-Key",it.toString()) } },
            "requestBody" to if(body is ByteArray) null else json.valueToTree<JsonNode>(body),"responseHeaders" to response.headers().map().mapValues { it.value.joinToString(",") },
            "responseBody" to runCatching { json.readTree(response.body()) }.getOrNull()))
        return response
    }
    private fun call(method: String,path: String,body: Any?=null,token: String?=adminToken,status: Int=200,key: UUID?=UUID.randomUUID()): JsonNode {
        val response=raw(method,path,body,token,key)
        assertEquals(status,response.statusCode(),"$method $path: ${response.body()}")
        assertEquals(listOf("no-store"),response.headers().allValues("Cache-Control"))
        assertEquals(1,response.headers().allValues("X-Request-Id").size)
        UUID.fromString(response.headers().firstValue("X-Request-Id").orElseThrow())
        return json.readTree(response.body())
    }
    @Test fun `guests browse published content and download readonly trial snapshots`() {
        val f=fixture()
        val bank=call("GET","/question-banks/${f.bank}?includeProgress=true",token=null)
        call("GET","/subjects/${f.subject}",token=null)
        call("GET","/question-banks/${f.bank}/chapters",token=null)
        val questions=call("GET","/question-banks/${f.bank}/questions",token=null)
        assertEquals(4,questions["total"].asInt())
        assertTrue(questions["items"].all { it["correctAnswer"].isNull && it["explanation"].isNull })
        call("GET","/me",token=null,status=401)
        val accounts=jdbc.queryForObject("SELECT count(*) FROM user_account",Long::class.java)
        val sessions=jdbc.queryForObject("SELECT count(*) FROM practice_session",Long::class.java)
        val scope=mapOf("questionBankId" to f.bank,"count" to 4,"order" to "SEQUENTIAL")
        val input=mapOf("scope" to scope,"expectedContentVersion" to bank["contentVersion"].asLong(),"feedback" to "IMMEDIATE")
        val trial=call("POST","/practice/trial-snapshots",input,null)
        assertEquals(4,trial["items"].size());assertEquals(4,trial["offlineGrading"].size())
        assertEquals(4,trial["items"].map { it["question"]["type"].asText() }.distinct().size)
        assertTrue(trial["items"].all { it["question"]["correctAnswer"].isNull && it["question"]["referenceAnswer"].isNull && it["question"]["explanation"].isNull })
        assertEquals(accounts,jdbc.queryForObject("SELECT count(*) FROM user_account",Long::class.java))
        assertEquals(sessions,jdbc.queryForObject("SELECT count(*) FROM practice_session",Long::class.java))
        call("POST","/practice/trial-snapshots",input+mapOf("expectedContentVersion" to bank["contentVersion"].asLong()+1),null,status=409)
        call("POST","/practice/trial-snapshots",input+mapOf("scope" to scope+mapOf("selectionKind" to "WRONG")),null,status=403)
        jdbc.update("UPDATE question_bank SET publication_status='DRAFT' WHERE id=?",f.bank)
        call("GET","/question-banks/${f.bank}",token=null,status=404)
        call("GET","/questions/${f.questions.first()}",token=null,status=404)
        call("POST","/practice/trial-snapshots",input,null,status=404)
    }
    private fun id(value: JsonNode)=UUID.fromString(value["id"].asText())
    private fun code(challengeId: UUID): String {
        val row=jdbc.queryForMap("SELECT * FROM mail_delivery WHERE challenge_id=?",challengeId)
        val expiry=(row["expires_at"] as java.sql.Timestamp).toInstant()
        return mailCrypto.decrypt(PreparedMailEnvelope(challengeId,row["template_code"] as String,1,expiry,row["ciphertext"] as String,row["nonce"] as String,(row["key_version"] as Number).toInt())).code
    }
    private fun student(): Student {
        val email="${UUID.randomUUID()}@example.test"
        val challenge=call("POST","/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to email),null,201)
        val registration=call("POST","/auth/email-registrations",mapOf("challengeId" to id(challenge),"code" to code(id(challenge)),"password" to password,"nickname" to "测试学生"),null,201)
        val login=call("POST","/auth/sessions",mapOf("email" to email,"password" to password,"deviceId" to UUID.randomUUID(),"clientType" to "WEB"),null)
        return Student(id(registration),email,login["accessToken"].asText())
    }
    private fun question(bank: UUID,type: String): Map<String,Any?> = mapOf("questionBankId" to bank,"type" to type,"stem" to "原题$type","explanation" to "原解析",
        "options" to if(type.endsWith("CHOICE")) listOf(mapOf("key" to "A","content" to "甲"),mapOf("key" to "B","content" to "乙"),mapOf("key" to "C","content" to "丙")) else emptyList<Any>(),
        "correctAnswer" to when(type) { "SINGLE_CHOICE" -> listOf("A");"MULTIPLE_CHOICE" -> listOf("A","B");else -> emptyList<String>() },
        "correctValue" to false.takeIf { type=="TRUE_FALSE" },"referenceAnswer" to "原参考答案".takeIf { type=="SHORT_ANSWER" })
    private fun fixture(audiences: List<Map<String,Any>> = emptyList(),maintainers: List<UUID> = emptyList()): Fixture {
        val subject=id(call("POST","/admin/subjects",mapOf("name" to "课程${UUID.randomUUID()}")))
        val bank=id(call("POST","/admin/question-banks",mapOf("subjectId" to subject,"name" to "复习题库","scopeType" to if(audiences.isEmpty()) "ALL" else "TARGETED","audiences" to audiences,"maintainerIds" to maintainers)))
        val questions=listOf("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER").map { id(call("POST","/admin/questions",question(bank,it))) }
        val current=call("GET","/admin/question-banks/$bank")
        call("PUT","/admin/question-banks/$bank/publication",mapOf("expectedVersion" to current["version"].asLong(),"status" to "PUBLISHED"))
        return Fixture(subject,bank,questions)
    }
    private fun createPractice(s: Student,f: Fixture,feedback: String="AFTER_FINISH"): JsonNode {
        val bank=call("GET","/question-banks/${f.bank}",token=s.token)
        return call("POST","/practice/sessions",mapOf("scope" to mapOf("questionBankId" to f.bank,"count" to 4,"order" to "RANDOM"),"expectedContentVersion" to bank["contentVersion"].asLong(),"feedback" to feedback,"deviceId" to UUID.randomUUID()),s.token)
    }
    private fun answers(session: JsonNode): List<Map<String,Any>> = session["items"].map { item ->
        val answer=when(item["question"]["type"].asText()) { "SINGLE_CHOICE" -> mapOf("optionKeys" to listOf("A"));"MULTIPLE_CHOICE" -> mapOf("optionKeys" to listOf("B","A"));"TRUE_FALSE" -> mapOf("value" to false);else -> mapOf("text" to "学生作答") }
        mapOf("itemId" to item["itemId"].asText(),"answer" to answer,"confirmed" to true,"marked" to true)
    }

    @Test fun `shared content recommendation choice practice grading feedback and real statistics form one HTTP loop`() {
        val s=student();val empty=call("GET","/me",token=s.token);assertTrue(empty["majorId"].isNull)
        val college=id(call("POST","/admin/colleges",mapOf("name" to "学院${UUID.randomUUID()}","code" to UUID.randomUUID().toString())))
        val major=id(call("POST","/admin/majors",mapOf("collegeId" to college,"name" to "专业","code" to "M1")))
        val f=fixture(listOf(mapOf("majorId" to major)))
        assertEquals(0,call("GET","/me/recommendations",token=s.token)["items"].count { it["subject"]["id"].asText()==f.subject.toString() })
        call("GET","/question-banks/${f.bank}",token=s.token)
        call("PUT","/me/profile",mapOf("expectedVersion" to empty["version"].asLong(),"nickname" to "自主注册用户","collegeId" to college,"majorId" to major,"enrollmentYear" to 2025),s.token)
        assertTrue(jdbc.queryForMap("SELECT college_id FROM user_profile WHERE user_id=?",s.id)["college_id"]==null)
        assertEquals(college.toString(),call("GET","/me",token=s.token)["collegeId"].asText())
        assertTrue(call("GET","/me/recommendations",token=s.token)["items"].any { it["subject"]["id"].asText()==f.subject.toString() })
        call("PUT","/me/subjects/${f.subject}",mapOf("preferredBankId" to f.bank),s.token)
        assertTrue(call("GET","/me/subjects",token=s.token)["items"].any { it["subject"]["id"].asText()==f.subject.toString() })
        call("PUT","/me/favorites/${f.questions.first()}",token=s.token)
        val session=createPractice(s,f);val sessionId=id(session)
        session["items"].forEach { assertTrue(it["question"]["explanation"].isNull);assertTrue(it["question"]["correctAnswer"].isNull);assertTrue(it["question"]["referenceAnswer"].isNull) }
        val originalItem=session["items"].first { it["question"]["type"].asText()=="TRUE_FALSE" }
        val originalQuestion=UUID.fromString(originalItem["question"]["id"].asText())
        call("PUT","/admin/questions/$originalQuestion",question(f.bank,"TRUE_FALSE")+mapOf("stem" to "更新后的题干","correctValue" to true,"expectedVersion" to 1))
        val progress=mapOf("expectedVersion" to 1,"currentIndex" to 1,"durationSeconds" to 0,"items" to answers(session),"writerToken" to session["writer"]["writerToken"].asText(),"clientSequence" to 1)
        val saved=call("PUT","/practice/sessions/$sessionId/progress-ack",progress,s.token)
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress,s.token,409)
        val restored=call("GET","/practice/sessions/$sessionId",token=s.token)
        assertEquals(session["items"].map { it["itemId"].asText() },restored["items"].map { it["itemId"].asText() })
        assertEquals("原题TRUE_FALSE",restored["items"].first { it["question"]["type"].asText()=="TRUE_FALSE" }["question"]["stem"].asText())
        val finish=mapOf("expectedVersion" to saved["version"].asLong(),"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText())
        val result=call("POST","/practice/sessions/$sessionId/finish",finish,s.token)
        assertEquals(result,call("GET","/practice/sessions/$sessionId/result",token=s.token))
        assertEquals(result,call("GET","/me/practice-history/$sessionId",token=s.token))
        assertEquals(result,call("GET","/admin/students/${s.id}/practice-history/$sessionId"))
        assertEquals(1,call("GET","/admin/students/${s.id}/practice-history")["total"].asInt())
        assertEquals(1,call("GET","/admin/students/${s.id}/statistics?period=ALL")["practiceCount"].asInt())
        assertEquals(3,result["objective"]["correct"].asInt());assertEquals(1,result["shortAnswer"]["unrated"].asInt())
        assertEquals(result["id"],call("POST","/practice/sessions/$sessionId/finish",finish,s.token)["id"])
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_result WHERE session_id=?",Int::class.java,sessionId))
        val short=result["items"].first { it["question"]["type"].asText()=="SHORT_ANSWER" }
        call("PUT","/practice/sessions/$sessionId/items/${short["itemId"].asText()}/self-assessment",mapOf("expectedVersion" to result["version"].asLong(),"assessment" to "WRONG"),s.token)
        val stats=call("GET","/me/statistics?period=ALL",token=s.token);assertEquals(1,stats["practiceCount"].asInt());assertEquals(3,stats["correctCount"].asInt());assertEquals(1,stats["selfRatedWrongCount"].asInt())
        assertEquals(1,call("GET","/me/wrong-questions",token=s.token)["total"].asInt())
        assertEquals(1,call("GET","/me/wrong-questions/${short["question"]["id"].asText()}/history",token=s.token)["total"].asInt())
        assertEquals(1,call("GET","/me/favorites",token=s.token)["total"].asInt())
        call("DELETE","/me/subjects/${f.subject}",token=s.token)
        assertEquals(1,call("GET","/me/practice-history",token=s.token)["total"].asInt())
        val feedback=id(call("POST","/me/question-feedback",mapOf("questionId" to originalQuestion,"revisionId" to originalItem["question"]["revisionId"].asText(),"category" to "ANSWER","body" to "请核查参考答案"),s.token))
        call("PUT","/admin/question-feedback/$feedback",mapOf("expectedVersion" to 1,"status" to "RESOLVED","response" to "已核实并修正"))
        val reply=call("GET","/me/question-feedback",token=s.token)["items"].first { it["id"].asText()==feedback.toString() }
        assertEquals("原题TRUE_FALSE",reply["question"]["stem"].asText());assertEquals("已核实并修正",reply["response"].asText())
        assertTrue(call("GET","/admin/question-feedback")["items"].any { it["id"].asText()==feedback.toString() })
        val request=id(call("POST","/me/course-requests",mapOf("courseName" to "尚未提供的课程","body" to "希望增加复习题库"),s.token))
        call("PUT","/admin/course-requests/$request",mapOf("expectedVersion" to 1,"status" to "IN_PROGRESS","response" to "正在整理"))
        assertEquals("IN_PROGRESS",call("GET","/me/course-requests",token=s.token)["items"].first()["status"].asText())
        assertTrue(call("GET","/admin/course-requests")["items"].any { it["id"].asText()==request.toString() })
        call("GET","/admin/statistics/summary?period=ALL");call("GET","/admin/statistics/activity");call("GET","/admin/statistics/rankings");call("GET","/admin/statistics/organizations")
        assertTrue(call("GET","/admin/dashboard")["answeredCount"].asInt()>=4)
    }

    @Test fun `administrator separation assigned content and last platform administrator are enforced`() {
        val student=student()
        call("GET","/admin/users",token=student.token,status=403);call("GET","/me",token=adminToken,status=403)
        val admin=id(call("POST","/admin/administrators",mapOf("username" to "editor_${UUID.randomUUID().toString().take(8)}","name" to "内容管理员","role" to "CONTENT_ADMIN","password" to password)))
        val username=jdbc.queryForObject("SELECT username FROM admin_account WHERE id=?",String::class.java,admin)!!
        val token=call("POST","/admin/auth/sessions",mapOf("username" to username,"password" to password,"deviceId" to UUID.randomUUID()),null)["accessToken"].asText()
        val assigned=fixture(maintainers=listOf(admin));val other=fixture()
        val bank=call("GET","/admin/question-banks/${assigned.bank}",token=token)
        val edit=mapOf("subjectId" to assigned.subject,"name" to "编辑后的题库","expectedVersion" to bank["version"].asLong())
        call("PUT","/admin/question-banks/${assigned.bank}",edit,token)
        assertEquals(admin.toString(),call("GET","/admin/question-banks/${assigned.bank}",token=token)["maintainerIds"].first().asText())
        call("PUT","/admin/question-banks/${assigned.bank}",edit+mapOf("expectedVersion" to bank["version"].asLong()+1,"maintainerIds" to emptyList<UUID>()),token,403)
        call("GET","/admin/question-banks/${other.bank}",token=token,status=404)
        call("GET","/admin/users",token=token,status=403)
        call("DELETE","/admin/administrators/$platformId?expectedVersion=1",status=409)
        val self=call("GET","/admin/auth/me")
        assertFalse(self.has("passwordHash"));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM user_account WHERE id=?",Int::class.java,platformId))
        call("PUT","/admin/administrators/$admin",mapOf("username" to username,"name" to "更新后的编辑","role" to "CONTENT_ADMIN","expectedVersion" to 1))
        call("POST","/admin/auth/logout",token=token)
        call("GET","/admin/auth/me",token=token,status=401)
        val nextToken=call("POST","/admin/auth/sessions",mapOf("username" to username,"password" to password,"deviceId" to UUID.randomUUID()),null)["accessToken"].asText()
        call("DELETE","/admin/administrators/$admin?expectedVersion=2")
        call("GET","/admin/auth/me",token=nextToken,status=401)
        assertTrue(call("GET","/admin/audit-logs")["total"].asInt()>0)
    }

    @Test fun `administrator status contract maps disabled and rejects undocumented inactive`() {
        val username="disabled_${UUID.randomUUID().toString().take(8)}"
        val createdDisabled=id(call("POST","/admin/administrators",mapOf("username" to username,"name" to "停用管理员","role" to "CONTENT_ADMIN","status" to "DISABLED","password" to password)))
        assertEquals("DISABLED",call("GET","/admin/administrators?pageSize=100")["items"].first { it["id"].asText()==createdDisabled.toString() }["status"].asText())
        call("PUT","/admin/administrators/$createdDisabled",mapOf("username" to username,"name" to "停用管理员","role" to "CONTENT_ADMIN","status" to "DISABLED","expectedVersion" to 1))
        val listed=call("GET","/admin/administrators?pageSize=100")["items"].first { it["id"].asText()==createdDisabled.toString() }
        assertEquals("DISABLED",listed["status"].asText())
        call("PUT","/admin/administrators/$createdDisabled",mapOf("username" to username,"name" to "停用管理员","role" to "CONTENT_ADMIN","status" to "INACTIVE","expectedVersion" to 2),status=422)
    }

    @Test fun `idempotency compares payload and importing invalid documents rolls back the whole batch`() {
        val key=UUID.randomUUID();val body=mapOf("name" to "幂等${UUID.randomUUID()}","code" to UUID.randomUUID().toString())
        val first=call("POST","/admin/colleges",body,key=key);assertEquals(first,call("POST","/admin/colleges",body,key=key))
        call("POST","/admin/colleges",body+mapOf("name" to "不同内容"),status=409,key=key)
        val f=fixture();val bank=call("GET","/admin/question-banks/${f.bank}")
        val invalid=question(f.bank,"SINGLE_CHOICE")+mapOf("correctAnswer" to listOf("X"))
        val batch=mapOf("expectedContentVersion" to bank["contentVersion"].asLong(),"questions" to listOf(question(f.bank,"TRUE_FALSE"),invalid))
        assertFalse(call("POST","/admin/question-banks/${f.bank}/import-preview",batch)["valid"].asBoolean())
        call("POST","/admin/question-banks/${f.bank}/imports",batch,status=422)
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM question WHERE bank_id=?",Int::class.java,f.bank))
        val valid=batch+mapOf("questions" to listOf(question(f.bank,"TRUE_FALSE")))
        assertEquals(1,call("POST","/admin/question-banks/${f.bank}/imports",valid)["questionIds"].size())
        val version=call("GET","/admin/question-banks/${f.bank}")["contentVersion"].asLong()
        jdbc.execute("CREATE FUNCTION reject_test_revision() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.stem = ''中断批次'' THEN RAISE EXCEPTION ''simulated write failure''; END IF; RETURN NEW; END'")
        jdbc.execute("CREATE TRIGGER reject_test_revision BEFORE INSERT ON question_revision FOR EACH ROW EXECUTE FUNCTION reject_test_revision()")
        try {
            val interrupted=mapOf("expectedContentVersion" to version,"questions" to listOf(question(f.bank,"TRUE_FALSE"),question(f.bank,"TRUE_FALSE")+mapOf("stem" to "中断批次")))
            call("POST","/admin/question-banks/${f.bank}/imports",interrupted,status=500)
            assertEquals(5,jdbc.queryForObject("SELECT count(*) FROM question WHERE bank_id=?",Int::class.java,f.bank))
            assertEquals(version,call("GET","/admin/question-banks/${f.bank}")["contentVersion"].asLong())
        } finally { jdbc.execute("DROP TRIGGER reject_test_revision ON question_revision");jdbc.execute("DROP FUNCTION reject_test_revision()") }
    }

    @Test fun `concurrent progress and finish commands cannot overwrite answers or duplicate results`() {
        val s=student();val f=fixture();val session=createPractice(s,f);val id=id(session)
        val progress=mapOf("expectedVersion" to 1,"currentIndex" to 0,"durationSeconds" to 0,"items" to answers(session),"writerToken" to session["writer"]["writerToken"].asText(),"clientSequence" to 1)
        val pool=Executors.newFixedThreadPool(2)
        try {
            val updates=(1..2).map { pool.submit<Int> { raw("PUT","/practice/sessions/$id/progress-ack",progress,s.token).statusCode() } }.map { it.get() }.sorted()
            assertEquals(listOf(200,409),updates)
            val finish=mapOf("expectedVersion" to 2,"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText())
            val results=(1..2).map { pool.submit<String> { val r=raw("POST","/practice/sessions/$id/finish",finish,s.token);assertEquals(200,r.statusCode(),r.body());json.readTree(r.body())["id"].asText() } }.map { it.get() }
            assertEquals(results[0],results[1]);assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_result WHERE session_id=?",Int::class.java,id))
        } finally { pool.shutdownNow() }
    }

    @Test fun `immediate feedback freezes confirmed answers and wrong favorite practice can be resumed or cancelled`() {
        val s=student();val f=fixture();val session=createPractice(s,f,"IMMEDIATE");val sessionId=id(session)
        val multiple=session["items"].first { it["question"]["type"].asText()=="MULTIPLE_CHOICE" }
        val itemId=multiple["itemId"].asText();val questionId=multiple["question"]["id"].asText()
        fun progress(version: Int,keys: List<String>,confirmed: Boolean)=mapOf("expectedVersion" to version,"currentIndex" to 0,"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText(),"clientSequence" to version,
            "items" to listOf(mapOf("itemId" to itemId,"answer" to mapOf("optionKeys" to keys),"confirmed" to confirmed)))
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress(1,listOf("A"),false),s.token)
        val draft=call("GET","/practice/sessions/$sessionId",token=s.token)
        assertTrue(draft["items"].first { it["itemId"].asText()==itemId }["question"]["correctAnswer"].isNull)
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress(2,listOf("B","A"),true),s.token)
        val confirmed=call("GET","/practice/sessions/$sessionId",token=s.token)
        assertEquals("CORRECT",confirmed["items"].first { it["itemId"].asText()==itemId }["outcome"].asText())
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress(3,listOf("A","B"),true),s.token)
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress(4,listOf("A"),true),s.token,409)
        call("POST","/practice/sessions/$sessionId/cancel",mapOf("expectedVersion" to 4,"writerToken" to session["writer"]["writerToken"].asText()),s.token)
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress(5,listOf("A","B"),true),s.token,409)
        call("GET","/practice/sessions/$sessionId/result",token=s.token,status=409)
        call("PUT","/me/favorites/$questionId",token=s.token)
        fun scope(kind: String)=mapOf("questionBankId" to f.bank,"count" to 1,"order" to "SEQUENTIAL","selectionKind" to kind)
        fun selected(kind: String): JsonNode {
            val preview=call("POST","/practice/scope-preview",scope(kind),s.token)
            assertEquals(1,preview["availableCount"].asInt())
            return call("POST","/practice/sessions",mapOf("scope" to scope(kind),"expectedContentVersion" to preview["contentVersion"].asLong(),"deviceId" to UUID.randomUUID()),s.token)
        }
        val favorite=selected("FAVORITE")
        assertEquals(questionId,favorite["items"].first()["question"]["id"].asText())
        call("POST","/practice/sessions/${id(favorite)}/finish",mapOf("expectedVersion" to 1,"durationSeconds" to 0,"writerToken" to favorite["writer"]["writerToken"].asText(),
            "items" to listOf(mapOf("itemId" to favorite["items"].first()["itemId"].asText(),"answer" to mapOf("optionKeys" to listOf("A")),"confirmed" to true))),s.token)
        assertEquals(1,call("GET","/me/wrong-questions?questionBankId=${f.bank}",token=s.token)["total"].asInt())
        val wrong=selected("WRONG")
        call("POST","/practice/sessions/${id(wrong)}/finish",mapOf("expectedVersion" to 1,"durationSeconds" to 0,"writerToken" to wrong["writer"]["writerToken"].asText(),"items" to answers(wrong)),s.token)
        assertEquals(0,call("GET","/me/wrong-questions?questionBankId=${f.bank}",token=s.token)["total"].asInt())
        assertEquals(1,call("GET","/me/wrong-questions?status=MASTERED&questionBankId=${f.bank}",token=s.token)["total"].asInt())
        assertEquals(2,call("GET","/me/wrong-questions/$questionId/history",token=s.token)["total"].asInt())
        assertEquals(id(wrong).toString(),call("GET","/me/recent-learning",token=s.token)["items"].first()["id"].asText())
        call("DELETE","/me/favorites/$questionId",token=s.token)
        assertEquals(0,call("POST","/practice/scope-preview",scope("FAVORITE"),s.token)["availableCount"].asInt())
    }

    @Test fun `announcements respect recipients platforms and scheduled visibility`() {
        val one=student();val two=student()
        val announcement=id(call("POST","/admin/announcements",mapOf("title" to "定向公告","summary" to "摘要","body" to "正文","audience" to "SELECTED","userIds" to listOf(one.id),"platforms" to listOf("WEB"),"status" to "SCHEDULED","publishAt" to Instant.now().plusSeconds(3600))))
        call("PUT","/admin/announcements/$announcement",mapOf("title" to "更新后的定向公告","summary" to "摘要","body" to "正文","audience" to "SELECTED","userIds" to listOf(one.id),"platforms" to listOf("WEB"),"status" to "SCHEDULED","publishAt" to Instant.now().plusSeconds(3600),"expectedVersion" to 1))
        assertTrue(call("GET","/admin/announcements")["items"].any { it["id"].asText()==announcement.toString() })
        assertFalse(call("GET","/announcements",token=one.token)["items"].any { it["id"].asText()==announcement.toString() })
        jdbc.update("UPDATE announcement SET publish_at=now()-interval '1 minute' WHERE id=?",announcement)
        assertTrue(call("GET","/announcements",token=one.token)["items"].any { it["id"].asText()==announcement.toString() })
        assertFalse(call("GET","/announcements",token=two.token)["items"].any { it["id"].asText()==announcement.toString() })
        call("DELETE","/admin/announcements/$announcement?expectedVersion=2")
        assertFalse(call("GET","/announcements",token=one.token)["items"].any { it["id"].asText()==announcement.toString() })
    }

    @Test fun `offline snapshots compact synchronization and strict writer handoff preserve all answers`() {
        val s=student();val other=student();val f=fixture();val device=UUID.randomUUID();val next=UUID.randomUUID()
        val bank=call("GET","/question-banks/${f.bank}",token=s.token)
        val selected=mapOf("questionBankId" to f.bank,"count" to 1,"questionIds" to listOf(f.questions.first()))
        val selectedSession=call("POST","/practice/sessions",mapOf("scope" to selected,"expectedContentVersion" to bank["contentVersion"].asLong(),"deviceId" to UUID.randomUUID()),s.token)
        assertEquals(f.questions.first().toString(),selectedSession["items"].first()["question"]["id"].asText())
        call("POST","/practice/scope-preview",selected+mapOf("questionIds" to listOf(UUID.randomUUID())),s.token,422)
        val create=mapOf("scope" to mapOf("questionBankId" to f.bank,"count" to 4,"order" to "RANDOM"),"expectedContentVersion" to bank["contentVersion"].asLong(),"deviceId" to device)
        val session=call("POST","/practice/sessions",create,s.token);val sessionId=id(session)
        assertEquals(4,session["configuration"]["count"].asInt());assertEquals(4,session["offlineGrading"].size())
        assertTrue(session["items"].all { it["question"]["correctAnswer"].isNull && it["question"]["referenceAnswer"].isNull })
        val token=session["writer"]["writerToken"].asText();assertEquals("ACTIVE",session["writer"]["state"].asText())
        val plain=call("GET","/practice/sessions/$sessionId",token=s.token)
        assertTrue(plain["offlineGrading"].isNull);assertTrue(plain["writer"]["writerToken"].isNull)
        fun snapshot(d: UUID,t: String,status: Int=200): JsonNode {
            val response=raw("GET","/practice/sessions/$sessionId/snapshot?deviceId=$d",token=s.token,extraHeaders=mapOf("X-Practice-Writer" to t))
            assertEquals(status,response.statusCode(),response.body());return json.readTree(response.body())
        }
        assertEquals(session["offlineGrading"],snapshot(device,token)["offlineGrading"])
        snapshot(next,token,409)
        val acquireKey=UUID.randomUUID();val waiting=call("POST","/practice/sessions/$sessionId/writer-acquire",mapOf("deviceId" to next),s.token,key=acquireKey)
        assertEquals("WAITING",waiting["state"].asText());assertTrue(waiting["writerToken"].isNull)
        assertEquals(waiting,call("POST","/practice/sessions/$sessionId/writer-acquire",mapOf("deviceId" to next),s.token,key=acquireKey))
        call("POST","/practice/sessions/$sessionId/writer-acquire",mapOf("deviceId" to UUID.randomUUID()),s.token,409)
        call("GET","/practice/sessions/$sessionId/writer-state?deviceId=$device",token=other.token,status=404)
        assertEquals(next.toString(),call("GET","/practice/sessions/$sessionId/writer-state?deviceId=$device",token=s.token)["pendingDeviceId"].asText())
        // A separate practice can be created while the first practice waits for handoff.
        assertNotEquals(sessionId,id(call("POST","/practice/sessions",create,s.token)))
        val progress=mapOf("expectedVersion" to 1,"currentIndex" to 2,"durationSeconds" to 0,"items" to answers(session),"writerToken" to token,"clientSequence" to 3)
        val saveKey=UUID.randomUUID();val ack=call("PUT","/practice/sessions/$sessionId/progress-ack",progress,s.token,key=saveKey)
        assertEquals(3,ack["acknowledgedSequence"].asInt());assertFalse(ack.has("items"))
        assertEquals(ack,call("PUT","/practice/sessions/$sessionId/progress-ack",progress,s.token,key=saveKey))
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress+mapOf("expectedVersion" to 2),s.token,422)
        val release=mapOf("deviceId" to device,"writerToken" to token,"expectedVersion" to 2,"clientSequence" to 4)
        call("POST","/practice/sessions/$sessionId/writer-release",release,s.token,409)
        val releaseKey=UUID.randomUUID()
        call("POST","/practice/sessions/$sessionId/writer-release",release+mapOf("clientSequence" to 3),s.token,key=releaseKey)
        call("POST","/practice/sessions/$sessionId/writer-release",release+mapOf("clientSequence" to 3),s.token,key=releaseKey)
        val acquired=call("GET","/practice/sessions/$sessionId/writer-state?deviceId=$next",token=s.token)
        assertEquals("ACTIVE",acquired["state"].asText());assertEquals(0,acquired["acknowledgedSequence"].asInt());assertTrue(acquired["pendingDeviceId"].isNull)
        val nextToken=acquired["writerToken"].asText();assertNotEquals(token,nextToken)
        val restored=snapshot(next,nextToken);assertEquals(2,restored["currentIndex"].asInt());assertTrue(restored["items"].all { !it["answer"].isNull })
        snapshot(device,token,409)
        call("PUT","/practice/sessions/$sessionId/progress-ack",progress+mapOf("expectedVersion" to 2,"clientSequence" to 4),s.token,409)
        call("POST","/practice/sessions/$sessionId/cancel",mapOf("expectedVersion" to 2,"writerToken" to token),s.token,409)
        val finish=mapOf("expectedVersion" to 2,"durationSeconds" to 0,"writerToken" to nextToken)
        call("POST","/practice/sessions/$sessionId/finish",finish+mapOf("writerToken" to token),s.token,409)
        val result=call("POST","/practice/sessions/$sessionId/finish",finish,s.token)
        assertEquals(3,result["objective"]["correct"].asInt());assertEquals(1,result["shortAnswer"]["answered"].asInt())
        val short=result["items"].first { it["question"]["type"].asText()=="SHORT_ANSWER" }
        call("PUT","/practice/sessions/$sessionId/items/${short["itemId"].asText()}/self-assessment",mapOf("expectedVersion" to result["version"].asLong(),"assessment" to "CORRECT"),s.token)
        call("PUT","/practice/sessions/$sessionId/items/${short["itemId"].asText()}/self-assessment",mapOf("expectedVersion" to result["version"].asLong(),"assessment" to "WRONG"),s.token,409)
    }

    @Test fun `released writers reacquire safely and compact acknowledgements bound repeated response size`() {
        val s=student();val f=fixture();val session=createPractice(s,f);val id=id(session);val device=UUID.fromString(session["writer"]["deviceId"].asText())
        val writer=call("POST","/practice/sessions/$id/writer-acquire",mapOf("deviceId" to device),s.token)
        val token=writer["writerToken"].asText()
        call("POST","/practice/sessions/$id/writer-release",mapOf("deviceId" to device,"writerToken" to token,"expectedVersion" to 1,"clientSequence" to 0),s.token)
        val released=call("GET","/practice/sessions/$id/writer-state?deviceId=$device",token=s.token)
        assertEquals("RELEASED",released["state"].asText());assertTrue(released["writerToken"].isNull)
        call("PUT","/practice/sessions/$id/progress-ack",mapOf("expectedVersion" to 1,"currentIndex" to 0,"durationSeconds" to 0,"writerToken" to token,"clientSequence" to 1),s.token,409)
        val renewed=call("POST","/practice/sessions/$id/writer-acquire",mapOf("deviceId" to device),s.token)
        val renewedToken=renewed["writerToken"].asText();assertNotEquals(token,renewedToken)
        val os=java.lang.management.ManagementFactory.getOperatingSystemMXBean() as com.sun.management.OperatingSystemMXBean
        val cpu=os.processCpuTime;val started=System.nanoTime();var bytes=0
        repeat(30) { index ->
            val ack=call("PUT","/practice/sessions/$id/progress-ack",mapOf("expectedVersion" to index+1,"currentIndex" to index%4,"durationSeconds" to 0,"writerToken" to renewedToken,"clientSequence" to index+1),s.token)
            assertEquals(index+1,ack["acknowledgedSequence"].asInt());bytes+=json.writeValueAsBytes(ack).size
        }
        val compactCpu=(os.processCpuTime-cpu)/1000000;val compactWall=(System.nanoTime()-started)/1000000
        val full=call("GET","/practice/sessions/$id",token=s.token)
        val fullBytes=json.writeValueAsBytes(full).size
        assertTrue(bytes/30<fullBytes)
        val report=mapOf("scenario" to "4题练习，30次串行增量保存；与单次完整练习读取比较响应大小", "requests" to 30,"concurrency" to 1,
            "compact" to mapOf("wallMillis" to compactWall,"jvmCpuMillis" to compactCpu,"responseBytes" to bytes,"averageResponseBytes" to bytes/30),
            "fullRead" to mapOf("responseBytes" to fullBytes))
        val dir=Path.of(".backend-runtime/verification");Files.createDirectories(dir);Files.writeString(dir.resolve("practice-sync-observation.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(report))
        assertEquals(31L,jdbc.queryForObject("SELECT version FROM practice_session WHERE id=?",Long::class.java,id))
    }

    @Test fun `v1 requires writer credentials and exposes one profile read and progress write`() {
        val s=student();val f=fixture();val bank=call("GET","/question-banks/${f.bank}",token=s.token)
        val input=mapOf("scope" to mapOf("questionBankId" to f.bank,"count" to 4),"expectedContentVersion" to bank["contentVersion"].asLong())
        call("POST","/practice/sessions",input,s.token,400)
        val session=createPractice(s,f);val sessionId=id(session)
        call("PUT","/practice/sessions/$sessionId/progress-ack",mapOf("expectedVersion" to 1,"currentIndex" to 0,"durationSeconds" to 0),s.token,400)
        call("PUT","/practice/sessions/$sessionId/progress",mapOf("expectedVersion" to 1),s.token,404)
        call("GET","/me/profile",token=s.token,status=405)
        call("GET","/me",token=s.token)
    }

    @Test fun `global question search is paginated and progress contains latest personal graded outcomes`() {
        val s=student();val another=student();val f=fixture();val hidden=fixture();val marker="search-${UUID.randomUUID()}"
        for((bank,q) in listOf(f.bank to f.questions[0],f.bank to f.questions[1],hidden.bank to hidden.questions[0])) {
            val current=call("GET","/admin/questions/$q")
            val type=current["type"].asText()
            val payload=question(bank,type)+mapOf("stem" to "$marker $type","expectedVersion" to current["version"].asLong())
            call("PUT","/admin/questions/$q",if(q==f.questions[0]) payload+mapOf("options" to listOf(mapOf("key" to "A","content" to "option-$marker"),mapOf("key" to "B","content" to "乙"),mapOf("key" to "C","content" to "丙"))) else payload)
        }
        val hiddenBank=call("GET","/admin/question-banks/${hidden.bank}")
        call("PUT","/admin/question-banks/${hidden.bank}/publication",mapOf("expectedVersion" to hiddenBank["version"].asLong(),"status" to "UNPUBLISHED"))
        val found=call("GET","/questions?keyword=$marker&pageSize=1",token=s.token)
        assertEquals(2,found["total"].asInt());assertEquals(1,found["items"].size())
        val first=found["items"].first();assertEquals(f.bank.toString(),first["questionBankId"].asText())
        val optionMatch=call("GET","/questions?keyword=option-$marker",token=s.token)
        assertEquals(1,optionMatch["total"].asInt());assertEquals(f.questions[0].toString(),optionMatch["items"].first()["id"].asText())
        assertTrue(first["correctAnswer"].isNull);assertTrue(first["referenceAnswer"].isNull);assertTrue(first["explanation"].isNull)
        val second=call("GET","/questions?keyword=$marker&pageSize=1&page=2",token=s.token)
        assertNotEquals(first["id"],second["items"].first()["id"])
        call("GET","/questions?keyword=%20",token=s.token,status=422)
        call("GET","/questions?keyword="+"x".repeat(201),token=s.token,status=422)
        assertEquals(2,call("GET","/questions?keyword=$marker",token=null)["total"].asInt())
        val session=createPractice(s,f)
        val result=call("POST","/practice/sessions/${id(session)}/finish",mapOf("expectedVersion" to 1,"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText(),"items" to answers(session)),s.token)
        assertEquals(3,call("GET","/me/question-progress",token=s.token)["total"].asInt())
        val short=result["items"].first { it["question"]["type"].asText()=="SHORT_ANSWER" }
        call("PUT","/practice/sessions/${id(session)}/items/${short["itemId"].asText()}/self-assessment",mapOf("expectedVersion" to result["version"].asLong(),"assessment" to "WRONG"),s.token)
        val progress=call("GET","/me/question-progress?questionBankId=${f.bank}&pageSize=2",token=s.token)
        assertEquals(4,progress["total"].asInt());assertEquals(2,progress["items"].size())
        val rest=call("GET","/me/question-progress?questionBankId=${f.bank}&pageSize=2&page=2",token=s.token)
        val all=progress["items"].toList()+rest["items"].toList()
        assertEquals(4,all.map { it["questionId"].asText() }.distinct().size)
        assertEquals("WRONG",all.first { it["questionId"]==short["question"]["id"] }["outcome"].asText())
        assertTrue(all.all { it["questionBankId"].asText()==f.bank.toString() && it["lastPracticedAt"].isTextual })
        assertEquals(0,call("GET","/me/question-progress",token=another.token)["total"].asInt())
        val again=createPractice(s,f)
        val single=again["items"].first { it["question"]["type"].asText()=="SINGLE_CHOICE" }
        call("POST","/practice/sessions/${id(again)}/finish",mapOf("expectedVersion" to 1,"durationSeconds" to 0,"writerToken" to again["writer"]["writerToken"].asText(),"items" to listOf(mapOf("itemId" to single["itemId"].asText(),"answer" to mapOf("optionKeys" to listOf("C")),"confirmed" to true))),s.token)
        val latest=call("GET","/me/question-progress",token=s.token)
        assertEquals(4,latest["total"].asInt());assertEquals("WRONG",latest["items"].first { it["questionId"]==single["question"]["id"] }["outcome"].asText())
    }

    @Test fun `miniapp runtime uses real HTTP and PostgreSQL for a complete practice`() {
        val s=student();val f=fixture()
        val report=Path.of(".backend-runtime/verification/miniapp-live.json");Files.createDirectories(report.parent)
        val builder=ProcessBuilder("node","../miniapp/tests/live-backend.cjs").redirectErrorStream(true).redirectOutput(report.toFile())
        builder.environment().putAll(mapOf("QANDA_TEST_URL" to "http://127.0.0.1:$port","QANDA_TEST_TOKEN" to s.token,"QANDA_TEST_BANK_ID" to f.bank.toString(),"QANDA_TEST_USER_ID" to s.id.toString()))
        val process=builder.start()
        if(!process.waitFor(90,java.util.concurrent.TimeUnit.SECONDS)) { process.destroyForcibly();fail<Unit>("小程序真实HTTP验收超时") }
        assertEquals(0,process.exitValue(),Files.readString(report));assertTrue(json.readTree(Files.readString(report))["passed"].asBoolean())
    }

    @Test fun `OpenAPI contains current typed endpoints and version one`() {
        val response=http.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$port/v3/api-docs")).GET().build(),HttpResponse.BodyHandlers.ofString())
        assertEquals(200,response.statusCode(),response.body());val spec=json.readTree(response.body())
        assertEquals("1.0.0",spec["info"]["version"].asText());assertTrue(spec["paths"].has("/api/v1/practice/sessions"));assertTrue(spec["components"]["schemas"].has("QuestionInput"))
        val operations=spec["paths"].fields().asSequence().flatMap { it.value.fields().asSequence() }.filter { it.key in setOf("get","post","put","patch","delete") }.map { it.value }.toList()
        assertEquals(operations.size,operations.map { it["operationId"].asText() }.distinct().size)
        val dir=Path.of(".backend-runtime/verification");Files.createDirectories(dir);Files.writeString(dir.resolve("openapi.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(spec))
    }

    @Test fun `verification attempt limits survive failed registration transactions`() {
        val address="${UUID.randomUUID()}@example.test"
        val challenge=call("POST","/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to address),null,201)
        val actual=code(id(challenge));val wrong=if(actual=="000000") "111111" else "000000"
        val payload=mapOf("challengeId" to id(challenge),"code" to wrong,"password" to password)
        repeat(5) { call("POST","/auth/email-registrations",payload,null,409) }
        assertEquals(5,jdbc.queryForObject("SELECT failed_attempts FROM email_challenge WHERE id=?",Int::class.java,id(challenge)))
        call("POST","/auth/email-registrations",payload+mapOf("code" to actual),null,409)
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM user_account WHERE email_key=?",Int::class.java,address))
        call("POST","/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to address),null,429)
        outbox.dispatchOne()
        assertEquals("CANCELLED",jdbc.queryForObject("SELECT state FROM mail_delivery WHERE challenge_id=?",String::class.java,id(challenge)))
    }

    @Test fun `local mail uses encrypted outbox and a real SMTP capture transport`() {
        val address="${UUID.randomUUID()}@example.test"
        val challenge=call("POST","/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to address),null,201)
        repeat(200) { if(jdbc.queryForObject("SELECT state FROM mail_delivery WHERE challenge_id=?",String::class.java,id(challenge))!="ACCEPTED") outbox.dispatchOne() }
        assertEquals("ACCEPTED",jdbc.queryForObject("SELECT state FROM mail_delivery WHERE challenge_id=?",String::class.java,id(challenge)))
        val uri=URI("http://127.0.0.1:${mailpit.getMappedPort(8025)}/api/v1/search?query="+java.net.URLEncoder.encode("to:$address",Charsets.UTF_8))
        val search=json.readTree(http.send(HttpRequest.newBuilder(uri).GET().build(),HttpResponse.BodyHandlers.ofString()).body())
        val messageId=search["messages"].first()["ID"].asText()
        val message=json.readTree(http.send(HttpRequest.newBuilder(URI("http://127.0.0.1:${mailpit.getMappedPort(8025)}/api/v1/message/$messageId")).GET().build(),HttpResponse.BodyHandlers.ofString()).body())
        assertTrue(message["Text"].asText().contains(code(id(challenge))))
        val material=jdbc.queryForObject("SELECT ciphertext FROM mail_delivery WHERE challenge_id=?",String::class.java,id(challenge))!!
        assertFalse(material.contains(address));assertFalse(material.contains(code(id(challenge))))
    }

    @Test fun `HTTP rejects unknown duplicate malformed and oversized input with structured errors`() {
        val duplicate="{\"name\":\"甲\",\"name\":\"乙\",\"code\":\"DUP\"}".toByteArray()
        assertEquals(400,raw("POST","/admin/colleges",duplicate).statusCode())
        call("POST","/admin/colleges",mapOf("name" to "额外字段","code" to "UNKNOWN","unexpected" to true),status=400)
        assertEquals(400,raw("POST","/admin/colleges",byteArrayOf(0xc3.toByte(),0x28)).statusCode())
        val media=raw("GET","/health",token=null,accept="text/html")
        assertEquals(406,media.statusCode());assertEquals("NOT_ACCEPTABLE",json.readTree(media.body())["code"].asText())
        assertEquals("application/json",media.headers().firstValue("Content-Type").orElseThrow().substringBefore(';'))
        val f=fixture()
        assertEquals(413,raw("POST","/admin/question-banks/${f.bank}/images",ByteArray(5*1024*1024+1),contentType="image/png").statusCode())
    }

    @Test fun `password resets disable old sessions and disabled accounts cannot authenticate`() {
        val s=student()
        jdbc.update("UPDATE email_challenge SET created_at=created_at-interval '61 seconds' WHERE email_key=?",s.email)
        val challenge=call("POST","/auth/email-challenges",mapOf("purpose" to "RESET_PASSWORD","email" to s.email),null,201)
        val newPassword="New-learner-password-456"
        call("POST","/auth/password-resets",mapOf("challengeId" to id(challenge),"code" to code(id(challenge)),"newPassword" to newPassword),null)
        call("GET","/me",token=s.token,status=401)
        call("POST","/auth/sessions",mapOf("email" to s.email,"password" to password,"deviceId" to UUID.randomUUID()),null,401)
        val login=call("POST","/auth/sessions",mapOf("email" to s.email,"password" to newPassword,"deviceId" to UUID.randomUUID()),null)
        val token=login["accessToken"].asText();val me=call("GET","/me",token=token)
        call("PUT","/admin/users/${s.id}/status",mapOf("expectedVersion" to me["version"].asLong(),"status" to "DISABLED"))
        call("GET","/me",token=token,status=401)
    }

    @Test fun `configured administrator login locking idle timeout and password rules are enforced`() {
        val before=call("GET","/admin/security-policy")
        val strict=mapOf("expectedVersion" to before["version"].asLong(),"lockEnabled" to true,"maxAttempts" to 3,"lockMinutes" to 5,"sessionMinutes" to 5,"minPasswordLength" to 16,"requireLetter" to true,"requireNumber" to true,"requireMixedCase" to false)
        call("PUT","/admin/security-policy",strict)
        try {
            call("POST","/admin/administrators",mapOf("username" to "short_${UUID.randomUUID().toString().take(8)}","name" to "短密码","password" to "Abc123456789"),status=422)
            val username="locked_${UUID.randomUUID().toString().take(8)}"
            val target=id(call("POST","/admin/administrators",mapOf("username" to username,"name" to "锁定测试","password" to password)))
            repeat(3) { call("POST","/admin/auth/sessions",mapOf("username" to username,"password" to "Wrong-password-123","deviceId" to UUID.randomUUID()),null,401) }
            call("POST","/admin/auth/sessions",mapOf("username" to username,"password" to password,"deviceId" to UUID.randomUUID()),null,429)
            jdbc.update("DELETE FROM login_attempt")
            val login=call("POST","/admin/auth/sessions",mapOf("username" to username,"password" to password,"deviceId" to UUID.randomUUID()),null)
            jdbc.update("UPDATE admin_session SET last_seen_at=now()-interval '6 minutes' WHERE admin_id=?",target)
            call("GET","/admin/auth/me",token=login["accessToken"].asText(),status=401)
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM audit_log WHERE outcome='FAILURE'",Int::class.java)!!>0)
        } finally {
            val current=call("GET","/admin/security-policy")
            call("PUT","/admin/security-policy",strict+mapOf("expectedVersion" to current["version"].asLong(),"maxAttempts" to 5,"lockMinutes" to 30,"sessionMinutes" to 30,"minPasswordLength" to 12))
        }
    }

    @Test fun `images are normalized scoped and still available to their issued practice owner`() {
        val s=student();val f=fixture()
        val image=BufferedImage(2,2,BufferedImage.TYPE_INT_ARGB);val buffer=ByteArrayOutputStream();ImageIO.write(image,"png",buffer)
        val upload=raw("POST","/admin/question-banks/${f.bank}/images",buffer.toByteArray(),contentType="image/png")
        assertEquals(200,upload.statusCode(),upload.body());val file=id(json.readTree(upload.body()))
        call("PUT","/admin/questions/${f.questions.first()}",question(f.bank,"SINGLE_CHOICE")+mapOf("expectedVersion" to 1,"assetIds" to listOf(file)))
        val session=createPractice(s,f)
        fun readImage(token: String?): HttpResponse<ByteArray> {
            val request=HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/v1/files/$file")).GET()
            if(token!=null)request.header("Authorization","Bearer $token")
            val response=http.send(request.build(),HttpResponse.BodyHandlers.ofByteArray())
            exchanges.add(mapOf("method" to "GET","path" to "/api/v1/files/$file","status" to response.statusCode(),"responseHeaders" to response.headers().map().mapValues { it.value.joinToString(",") },"responseBody" to if(response.statusCode()==200) null else json.readTree(response.body())))
            if(response.statusCode()==200) { assertEquals("image/png",response.headers().firstValue("Content-Type").orElseThrow());assertEquals(listOf("nosniff"),response.headers().allValues("X-Content-Type-Options"));assertArrayEquals(buffer.toByteArray(),response.body()) }
            return response
        }
        assertEquals(200,readImage(s.token).statusCode())
        assertEquals(200,readImage(null).statusCode())
        jdbc.update("UPDATE question SET status='INACTIVE' WHERE id=?",f.questions.first())
        assertEquals(404,readImage(null).statusCode())
        assertEquals(200,readImage(s.token).statusCode())
        jdbc.update("UPDATE question SET status='ACTIVE' WHERE id=?",f.questions.first())
        val bank=call("GET","/admin/question-banks/${f.bank}")
        call("PUT","/admin/question-banks/${f.bank}/publication",mapOf("expectedVersion" to bank["version"].asLong(),"status" to "UNPUBLISHED"))
        call("GET","/question-banks/${f.bank}",token=s.token,status=404)
        assertEquals(404,readImage(null).statusCode())
        assertEquals(200,readImage(s.token).statusCode())
        assertEquals(404,readImage(student().token).statusCode())
        call("GET","/practice/sessions/${id(session)}",token=s.token)
        assertEquals(415,raw("POST","/admin/question-banks/${f.bank}/images","<svg/>".toByteArray(),contentType="image/svg+xml").statusCode())
    }

    @Test fun `local WeChat registration creates optional profile without a student email`() {
        val first=call("POST","/auth/wechat-sessions",mapOf("code" to "local-learner-1:${UUID.randomUUID()}","deviceId" to UUID.randomUUID()),null)
        assertTrue(first["session"].isNull)
        val registration=call("POST","/auth/wechat-registrations",mapOf("registrationToken" to first["registrationToken"].asText(),"nickname" to "微信学生"),null,201)
        val login=call("POST","/auth/wechat-sessions",mapOf("code" to "local-learner-1:${UUID.randomUUID()}","deviceId" to UUID.randomUUID()),null)
        val user=call("GET","/me",token=login["session"]["accessToken"].asText())
        assertEquals(registration["id"],user["id"]);assertTrue(user["email"].isNull);assertTrue(user["majorId"].isNull);assertTrue(user["wechatBound"].asBoolean())
    }

    @Test fun `database rejects broken references and immutable historical edits`() {
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO major(id,college_id,code,name,status) VALUES(?,?,?,?,'ACTIVE')",UUID.randomUUID(),UUID.randomUUID(),"BAD","非法专业") }
        val f=fixture()
        assertThrows(org.springframework.dao.DataAccessException::class.java) { jdbc.update("UPDATE question_revision SET stem='静默修改' WHERE question_id=?",f.questions.first()) }
        val other=fixture()
        val chapter=id(call("POST","/admin/question-banks/${other.bank}/chapters",mapOf("name" to "其他题库章节","sortOrder" to 0)))
        call("POST","/admin/questions",question(f.bank,"TRUE_FALSE")+mapOf("chapterId" to chapter),status=422)
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) { jdbc.update("UPDATE question SET chapter_id=? WHERE id=?",chapter,f.questions.first()) }
        val s=student()
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO user_subject(user_id,subject_id,preferred_bank_id) VALUES(?,?,?)",s.id,f.subject,other.bank) }
        call("PUT","/me/favorites/${f.questions.first()}",token=s.token)
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) { jdbc.update("INSERT INTO user_favorite(user_id,question_id) VALUES(?,?)",s.id,f.questions.first()) }
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM question WHERE bank_id=?",Int::class.java,f.bank))
    }

    @Test fun `statistics use Shanghai calendar days and count one user once across repeated activity`() {
        val s=student();val f=fixture();val session=createPractice(s,f)
        val result=call("POST","/practice/sessions/${id(session)}/finish",mapOf("expectedVersion" to 1,"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText(),"items" to answers(session)),s.token)
        jdbc.update("UPDATE practice_session SET submitted_at=? WHERE id=?",java.sql.Timestamp.from(Instant.parse("2026-10-27T16:30:00Z")),id(session))
        val days=call("GET","/me/statistics/days?startDate=2026-10-27&endDateExclusive=2026-10-29",token=s.token)
        assertEquals(0,days[0]["practiceCount"].asInt());assertEquals(1,days[1]["practiceCount"].asInt())
        val daily=call("GET","/me/statistics?period=DAY&periodDate=2026-10-28",token=s.token)
        assertEquals(1,daily["practiceCount"].asInt());assertEquals(3,daily["correctCount"].asInt())
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM user_activity WHERE user_id=? AND platform='WEB'",Int::class.java,s.id))
    }

    @Test fun `statistics reject dates outside the supported database range`() {
        val s=student();val date="%2B999999999-12-31"
        call("GET","/me/statistics?period=DAY&periodDate=$date",token=s.token,status=422)
        call("GET","/admin/students/${s.id}/statistics?period=DAY&periodDate=$date",status=422)
        call("GET","/admin/statistics/summary?period=DAY&periodDate=$date",status=422)
        call("GET","/admin/statistics/activity?period=DAY&periodDate=$date",status=422)
        call("GET","/admin/statistics/rankings?period=DAY&periodDate=$date",status=422)
        call("GET","/admin/statistics/organizations?period=DAY&periodDate=$date",status=422)
        call("GET","/me/statistics/days?startDate=$date&endDateExclusive=$date",token=s.token,status=422)
    }

    @Test fun `directories chapter ordering account lists and session ownership use real relational records`() {
        val s=student();val f=fixture()
        val college=id(call("POST","/admin/colleges",mapOf("name" to "目录${UUID.randomUUID()}","code" to UUID.randomUUID().toString())))
        val major=id(call("POST","/admin/majors",mapOf("collegeId" to college,"name" to "目录专业","code" to "M")))
        assertTrue(call("GET","/colleges?pageSize=100",token=null)["items"].any { it["id"].asText()==college.toString() })
        assertEquals(major.toString(),call("GET","/colleges/$college/majors",token=null)["items"].first()["id"].asText())
        call("PUT","/admin/colleges/$college",mapOf("name" to "更新后的学院","code" to UUID.randomUUID().toString(),"expectedVersion" to 1))
        call("PUT","/admin/majors/$major",mapOf("collegeId" to college,"name" to "更新后的专业","code" to "UPDATED","expectedVersion" to 1))
        call("PUT","/admin/subjects/${f.subject}",mapOf("name" to "更新后的课程${UUID.randomUUID()}","description" to "课程描述","expectedVersion" to 1))
        call("GET","/admin/colleges");call("GET","/admin/colleges/$college/majors");call("GET","/admin/subjects");call("GET","/subjects",token=s.token);call("GET","/subjects/${f.subject}",token=s.token)
        val first=id(call("POST","/admin/question-banks/${f.bank}/chapters",mapOf("name" to "第一章","sortOrder" to 0)))
        val second=id(call("POST","/admin/question-banks/${f.bank}/chapters",mapOf("name" to "第二章","sortOrder" to 1)))
        val bank=call("GET","/admin/question-banks/${f.bank}")
        call("GET","/admin/question-banks");call("GET","/admin/question-banks/${f.bank}/chapters")
        call("GET","/question-banks?subjectId=${f.subject}",token=s.token)
        call("PUT","/admin/question-banks/${f.bank}/chapter-order",mapOf("expectedContentVersion" to bank["contentVersion"].asLong(),"ids" to listOf(second,first)))
        assertEquals(second.toString(),call("GET","/question-banks/${f.bank}/chapters",token=s.token).first()["id"].asText())
        call("PUT","/admin/question-banks/${f.bank}/chapters/$first",mapOf("name" to "已修改章节","sortOrder" to 1,"expectedVersion" to 2))
        call("DELETE","/admin/question-banks/${f.bank}/chapters/$second?expectedVersion=2")
        call("PUT","/admin/questions/${f.questions.first()}",question(f.bank,"SINGLE_CHOICE")+mapOf("chapterId" to first,"expectedVersion" to 1))
        call("DELETE","/admin/question-banks/${f.bank}/chapters/$first?expectedVersion=3",status=409)
        assertEquals(1,call("GET","/question-banks/${f.bank}/questions?chapterId=$first",token=s.token)["total"].asInt())
        assertTrue(call("GET","/questions/${f.questions.first()}",token=s.token)["correctAnswer"].isNull)
        assertEquals("原题SINGLE_CHOICE",call("GET","/admin/questions/${f.questions.first()}")["stem"].asText())
        assertEquals(4,call("GET","/admin/question-banks/${f.bank}/questions")["total"].asInt())
        call("DELETE","/admin/questions/${f.questions.last()}?expectedVersion=1")
        assertEquals(3,call("GET","/question-banks/${f.bank}/questions",token=s.token)["total"].asInt())
        assertEquals("1.0.0",call("GET","/health",token=null)["version"].asText())
        val me=call("GET","/me",token=s.token)
        call("PUT","/me/wechat-binding",mapOf("expectedVersion" to me["version"].asLong(),"code" to "local-learner-3:${UUID.randomUUID()}"),s.token)
        assertTrue(call("GET","/me",token=s.token)["wechatBound"].asBoolean())
        assertTrue(call("GET","/admin/administrators")["items"].any { it["id"].asText()==platformId.toString() })
        call("GET","/admin/users/${s.id}");call("GET","/admin/users")
        val other=student();val otherSession=call("GET","/me/sessions",token=other.token).first()["id"].asText()
        call("DELETE","/me/sessions/$otherSession",token=s.token,status=404)
        call("DELETE","/auth/sessions/current",token=other.token)
        call("GET","/me",token=other.token,status=401)
        val extra=call("POST","/auth/sessions",mapOf("email" to s.email,"password" to password,"deviceId" to UUID.randomUUID()),null)
        call("DELETE","/me/sessions/${extra["sessionId"].asText()}",token=s.token)
        call("GET","/me",token=extra["accessToken"].asText(),status=401)
    }

    @Test fun `email binding password change and two proofs for email replacement preserve one user identity`() {
        val ticket=call("POST","/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","deviceId" to UUID.randomUUID()),null)
        val registration=call("POST","/auth/wechat-registrations",mapOf("registrationToken" to ticket["registrationToken"].asText()),null,201)
        fun wechatToken(): String=call("POST","/auth/wechat-sessions",mapOf("code" to "local-learner-2:${UUID.randomUUID()}","deviceId" to UUID.randomUUID()),null)["session"]["accessToken"].asText()
        val token=wechatToken();val address="${UUID.randomUUID()}@example.test"
        val binding=call("POST","/me/email-challenges",mapOf("purpose" to "BIND_EMAIL","email" to address),token)
        call("PUT","/me/email-binding",mapOf("expectedVersion" to 1,"newChallengeId" to id(binding),"newCode" to code(id(binding))),token)
        call("GET","/me",token=token,status=401)
        val boundToken=wechatToken()
        jdbc.update("UPDATE email_challenge SET created_at=created_at-interval '61 seconds' WHERE email_key=?",address)
        val passwordProof=call("POST","/me/email-challenges",mapOf("purpose" to "CHANGE_PASSWORD"),boundToken)
        call("PUT","/me/password",mapOf("expectedVersion" to 2,"challengeId" to id(passwordProof),"code" to code(id(passwordProof)),"newPassword" to password),boundToken)
        val login=call("POST","/auth/sessions",mapOf("email" to address,"password" to password,"deviceId" to UUID.randomUUID()),null)
        val currentToken=login["accessToken"].asText()
        jdbc.update("UPDATE email_challenge SET created_at=created_at-interval '61 seconds' WHERE email_key=?",address)
        val oldProof=call("POST","/me/email-challenges",mapOf("purpose" to "CHANGE_EMAIL_OLD"),currentToken)
        val replacement="${UUID.randomUUID()}@example.test"
        val newProof=call("POST","/me/email-challenges",mapOf("purpose" to "CHANGE_EMAIL_NEW","email" to replacement),currentToken)
        call("PUT","/me/email-binding",mapOf("expectedVersion" to 3,"oldChallengeId" to id(oldProof),"oldCode" to code(id(oldProof)),"newChallengeId" to id(newProof),"newCode" to code(id(newProof))),currentToken)
        val finalLogin=call("POST","/auth/sessions",mapOf("email" to replacement,"password" to password,"deviceId" to UUID.randomUUID()),null)
        assertEquals(registration["id"],call("GET","/me",token=finalLogin["accessToken"].asText())["id"])
        call("POST","/auth/sessions",mapOf("email" to address,"password" to password,"deviceId" to UUID.randomUUID()),null,401)
    }

    @Test fun `packaged commands initialize an empty isolated database and bootstrap through a real terminal`() {
        PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend");withUsername("qanda_backend");withPassword("isolated-cli-password") }.use { database ->
            database.start()
            val apiPort=java.net.ServerSocket(0).use { it.localPort }
            val environment=mapOf("BACKEND_MODE" to "test","BACKEND_BIND_ADDRESS" to "127.0.0.1","BACKEND_API_PORT" to apiPort.toString(),
                "BACKEND_DB_URL" to database.jdbcUrl,"BACKEND_DB_USER" to database.username,"BACKEND_DB_PASSWORD" to database.password,
                "BACKEND_COMMAND_DIGEST_KEYS" to "1:$key","BACKEND_IDENTITY_MAC_KEYS" to "1:$key","BACKEND_IDENTITY_RATE_KEY" to key,
                "BACKEND_WECHAT_PROVIDER" to "local","BACKEND_MAIL_ENABLED" to "false","BACKEND_FILES_ENABLED" to "false","BACKEND_DOCS_ENABLED" to "false")
            val config=Files.createTempFile("qanda-cli-verification-",".json")
            try {
                Files.setPosixFilePermissions(config,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
                Files.writeString(config,json.writeValueAsString(mapOf("environment" to environment,"java" to Path.of(System.getProperty("java.home"),"bin","java").toString(),"jar" to Path.of("target/qanda-backend-1.0.0.jar").toAbsolutePath().toString())))
                val report=Path.of(".backend-runtime/verification/bootstrap-cli.json");Files.createDirectories(report.parent)
                val process=ProcessBuilder("python3","scripts/verify-bootstrap-local.py",config.toString()).redirectErrorStream(true).redirectOutput(report.toFile()).start()
                if(!process.waitFor(180,java.util.concurrent.TimeUnit.SECONDS)) {
                    process.descendants().forEach { it.destroyForcibly() };process.destroyForcibly()
                    fail<Unit>("CLI verification timed out")
                }
                assertEquals(0,process.exitValue(),Files.readString(report));assertEquals("PASS",json.readTree(Files.readString(report))["status"].asText())
            } finally { Files.deleteIfExists(config) }
        }
    }

    @Test fun `paged collections keep whole summaries and server selected practice scope`() {
        val s=student();val other=student();val f=fixture()
        val extra=(1..3).map { id(call("POST","/admin/questions",question(f.bank,"SINGLE_CHOICE"))) }
        val ids=f.questions+extra
        ids.forEach { call("PUT","/me/favorites/$it",token=s.token) }
        val summary=call("GET","/me/question-collections/summary?kind=FAVORITE",token=s.token)
        assertEquals(7,summary["total"].asInt());assertEquals(7,summary["pendingCount"].asInt())
        assertEquals(7,summary["facets"].sumOf { it["count"].asInt() })
        assertEquals(0,call("GET","/me/question-collections/summary?kind=FAVORITE",token=other.token)["total"].asInt())
        val first=call("GET","/me/favorites?page=1&pageSize=5&chip=pending&sort=old&subjectId=${f.subject}",token=s.token)
        val second=call("GET","/me/favorites?page=2&pageSize=5&questionBankId=${f.bank}",token=s.token)
        assertEquals(7,first["total"].asInt());assertEquals(5,first["items"].size());assertEquals(2,second["items"].size())
        assertEquals("复习题库",first["items"][0]["questionBankName"].asText())
        call("GET","/me/favorites?chip=repeat",token=s.token,status=422)
        call("GET","/me/question-collections/summary?kind=UNKNOWN",token=s.token,status=422)
        val questions=call("GET","/question-banks/${f.bank}/questions?view=summary&pageSize=5",token=s.token)
        assertEquals(7,questions["total"].asInt());assertEquals(5,questions["items"].size())
        questions["items"].forEach { assertTrue(it["correctAnswer"].isNull);assertTrue(it["explanation"].isNull);assertEquals(0,it["options"].size()) }
        val full=call("GET","/questions/${ids.first()}",token=s.token)
        assertEquals(3,full["options"].size())
        call("GET","/questions?keyword=原题&view=summary&pageSize=5",token=s.token)
        call("GET","/questions?keyword=原题&view=invalid",token=s.token,status=422)
        val bank=call("GET","/question-banks/${f.bank}",token=s.token)
        val session=call("POST","/practice/sessions",mapOf("scope" to mapOf("questionBankId" to f.bank,"selectionKind" to "FAVORITE","collectionChip" to "pending","count" to 7),"expectedContentVersion" to bank["contentVersion"].asLong(),"feedback" to "AFTER_FINISH","deviceId" to UUID.randomUUID()),s.token)
        assertEquals(7,session["items"].size());assertEquals(7,session["favoriteQuestionIds"].size())
        val items=session["items"].map { item -> mapOf("itemId" to item["itemId"].asText(),"answer" to when(item["question"]["type"].asText()) {
            "TRUE_FALSE" -> mapOf("value" to true);"SHORT_ANSWER" -> mapOf("text" to "练习回答");else -> mapOf("optionKeys" to listOf("C"))
        },"confirmed" to true) }
        call("PUT","/practice/sessions/${id(session)}/progress-ack",mapOf("expectedVersion" to 1,"writerToken" to session["writer"]["writerToken"].asText(),"clientSequence" to 1,"currentIndex" to 0,"durationSeconds" to 0,"items" to items),s.token)
        call("POST","/practice/sessions/${id(session)}/finish",mapOf("expectedVersion" to 2,"durationSeconds" to 0,"writerToken" to session["writer"]["writerToken"].asText()),s.token)
        val wrong=call("GET","/me/wrong-questions?pageSize=5&sort=urgent&chip=recent",token=s.token)
        assertEquals(6,wrong["total"].asInt());assertEquals(5,wrong["items"].size())
        val wrongSummary=call("GET","/me/question-collections/summary?kind=WRONG",token=s.token)
        assertEquals(6,wrongSummary["total"].asInt());assertEquals(6,wrongSummary["wrongCount"].asInt());assertEquals(0,wrongSummary["repeatCount"].asInt())
        val overview=call("GET","/me/learning-overview",token=s.token)
        assertEquals(6,overview["answeredCount"].asInt());assertEquals(6,overview["wrongCount"].asInt());assertEquals(7,overview["favoriteCount"].asInt())
        assertEquals(1,overview["practiceCount"].asInt());assertTrue(overview["recentSession"].isNull)
        val progressBanks=call("GET","/question-banks?subjectId=${f.subject}&includeProgress=true",token=s.token)
        assertEquals(7,progressBanks["items"][0]["activeQuestionCount"].asInt());assertEquals(6,progressBanks["items"][0]["progress"]["answeredCount"].asInt())
        call("GET","/subjects?includeProgress=true",token=s.token)
        val subject=call("GET","/subjects/${f.subject}?includeProgress=true",token=s.token)
        assertEquals(7,subject["questionCount"].asInt());assertEquals(1,subject["bankCount"].asInt());assertEquals(6,subject["progress"]["answeredCount"].asInt())
        val after=call("GET","/me/question-collections/summary?kind=FAVORITE",token=s.token)
        assertEquals(6,after["practicedCount"].asInt());assertEquals(1,after["pendingCount"].asInt())
        val repeat=call("GET","/me/wrong-questions?chip=repeat&pageSize=5",token=s.token);assertEquals(0,repeat["total"].asInt())
    }

    @AfterAll fun exportEvidence() {
        val response=http.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$port/v3/api-docs")).GET().build(),HttpResponse.BodyHandlers.ofString())
        val spec=json.readTree(response.body())
        val operations=spec["paths"].fields().asSequence().flatMap { route -> route.value.fields().asSequence().filter { it.key in setOf("get","post","put","patch","delete") }.map { method -> Triple(route.key,method.key.uppercase(),method.value["operationId"].asText()) } }.toList()
        fun redact(node: JsonNode?): JsonNode? {
            if(node==null) return null
            if(node.isObject) {
                val result=json.createObjectNode()
                node.fields().forEachRemaining { (key,value) ->
                    result.set<JsonNode>(key,when {
                        key in setOf("password","newPassword") -> json.valueToTree("Redacted-password-123")
                        key=="writerToken" && value.isTextual -> json.valueToTree("00000000-0000-0000-0000-000000000001")
                        key in setOf("accessToken","registrationToken") && value.isTextual -> json.valueToTree((if(value.asText().startsWith("u_")) "u_" else if(value.asText().startsWith("a_")) "a_" else "")+"x".repeat(43))
                        key in setOf("code","oldCode","newCode") && value.isTextual && value.asText().matches(Regex("[0-9]{6}")) -> json.valueToTree("000000")
                        else -> redact(value)
                    })
                }
                return result
            }
            if(node.isArray) return json.createArrayNode().also { array -> node.forEach { array.add(redact(it)) } }
            return node
        }
        val events=exchanges.mapNotNull { event ->
            val op=operations.firstOrNull { (route,method,_) ->
                method==event["method"] && Regex("^"+route.split(Regex("\\{[^}]+}")).joinToString("[^/]+") { Regex.escape(it) }+"$").matches((event["path"] as String).substringBefore('?'))
            } ?: return@mapNotNull null
            event+mapOf("operationId" to op.third,"requestBody" to redact(event["requestBody"] as? JsonNode),"responseBody" to redact(event["responseBody"] as? JsonNode),"requestHeaders" to ((event["requestHeaders"] as? Map<*,*>) ?: emptyMap<Any,Any>()).mapValues { (key,value) -> if(key=="X-Practice-Writer") "00000000-0000-0000-0000-000000000001" else value })
        }
        val dir=Path.of(".backend-runtime/verification");Files.createDirectories(dir)
        Files.writeString(dir.resolve("openapi.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(spec))
        Files.writeString(dir.resolve("http-redacted.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(events))
        Files.walk(assetRoot).use { paths -> paths.sorted(java.util.Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
}
