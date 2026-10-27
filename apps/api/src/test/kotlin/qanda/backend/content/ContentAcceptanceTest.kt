package qanda.backend.content

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.autoconfigure.EnableAutoConfiguration
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.context.ApplicationContext
import org.springframework.context.annotation.*
import org.springframework.http.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import qanda.backend.identity.IdentityGuards
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.containers.wait.strategy.Wait
import qanda.backend.adminsecurity.AdminBootstrapService
import qanda.backend.adminsecurity.api.LocalOperatorProof
import qanda.backend.authorization.AuthorizationService
import qanda.backend.authorization.api.*
import qanda.backend.content.api.*
import qanda.backend.identity.IdentityService
import qanda.backend.platform.files.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.mail.*
import qanda.backend.platform.transaction.JdbcTransactions
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.sql.SQLException
import java.time.Clock
import java.util.*
import java.util.concurrent.*
import javax.imageio.ImageIO

@Configuration
@Profile("content-acceptance")
@EnableAutoConfiguration(exclude=[UserDetailsServiceAutoConfiguration::class])
@ComponentScan(basePackages=["qanda.backend.platform","qanda.backend.identity","qanda.backend.authorization","qanda.backend.adminsecurity","qanda.backend.content"],excludeFilters=[ComponentScan.Filter(type=FilterType.ANNOTATION,classes=[TestConfiguration::class])])
class ContentAcceptanceRuntime

@Tag("postgres")
@ActiveProfiles("content-acceptance")
@SpringBootTest(classes=[ContentAcceptanceRuntime::class],webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class ContentAcceptanceTest {
    companion object {
        private val database=PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend");withUsername("content_acceptance");withPassword("isolated-content-acceptance");start() }
        private val capture=GenericContainer<Nothing>("axllent/mailpit:v1.32.0").apply { withExposedPorts(1025,8025);waitingFor(Wait.forHttp("/api/v1/messages").forPort(8025));start() }
        private val assetRoot=Files.createTempDirectory("qanda-content-assets-")
        private fun key(n: Int)=Base64.getEncoder().encodeToString(ByteArray(32){n.toByte()})
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url",database::getJdbcUrl);registry.add("spring.datasource.username",database::getUsername);registry.add("spring.datasource.password",database::getPassword)
            registry.add("spring.flyway.locations") { "classpath:db/migration/platform,classpath:db/migration/identity,classpath:db/migration/authorization,classpath:db/migration/adminsecurity,classpath:db/migration/content" }
            registry.add("qanda.backend.mode") { "test" };registry.add("server.address") { "127.0.0.1" };registry.add("BACKEND_WECHAT_PROVIDER") { "local" }
            registry.add("qanda.backend.mail.enabled") { "true" };registry.add("qanda.backend.mail.dispatch-enabled") { "false" };registry.add("qanda.backend.mail.transport") { "local-capture" }
            registry.add("qanda.backend.mail.host") { "127.0.0.1" };registry.add("qanda.backend.mail.port") { capture.getMappedPort(1025) }
            registry.add("qanda.backend.files.enabled") { "true" };registry.add("qanda.backend.files.root") { assetRoot.toString() }
            registry.add("BACKEND_COMMAND_DIGEST_KEYS") { "1:"+key(31) };registry.add("BACKEND_IDENTITY_MAC_KEYS") { "1:"+key(32) };registry.add("BACKEND_IDENTITY_RATE_KEY") { key(33) };registry.add("BACKEND_MAIL_ENCRYPTION_KEYS") { "1:"+key(34) }
            registry.add("qanda.backend.request-limits.read-per-account") { "10000" };registry.add("qanda.backend.request-limits.write-per-account") { "10000" }
            registry.add("logging.level.root") { "WARN" };registry.add("spring.main.banner-mode") { "off" }
        }
    }
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var bootstrap: AdminBootstrapService
    @Autowired lateinit var identity: IdentityService
    @Autowired lateinit var tx: JdbcTransactions
    @Autowired lateinit var context: ApplicationContext
    @Autowired lateinit var outbox: JdbcMailOutbox
    @Autowired lateinit var crypto: MailCrypto
    @Autowired internal lateinit var transport: IdentityMailTransport
    @Autowired lateinit var assets: BinaryAssetPort
    @Autowired lateinit var content: ContentService
    @Autowired lateinit var authorization: AuthorizationService
    @Autowired lateinit var identities: AuthorizationIdentityPort
    @Autowired lateinit var identityGuards: IdentityGuards
    @Autowired lateinit var readPolicy: ContentAssetReadPolicy
    private val events=Collections.synchronizedList(mutableListOf<Map<String,Any?>>())
    private val checks=Collections.synchronizedList(mutableListOf<Map<String,Any?>>())
    private lateinit var adminToken: String
    private lateinit var ownerToken: String
    private lateinit var viewerToken: String
    private lateinit var otherToken: String
    private lateinit var adminId: UUID
    private lateinit var ownerId: UUID
    private lateinit var viewerId: UUID
    private lateinit var viewerCode: String
    private lateinit var college: UUID
    private lateinit var major: UUID
    private val target=Path.of(System.getenv("QANDA_CONTENT_EVIDENCE_DIR") ?: ".backend-runtime/verification/content")
    private val password="Content-acceptance-password-2026"
    private fun JsonNode.uuid(name: String)=UUID.fromString(this[name].asText())
    private data class Response(val value: JsonNode,val bytes: ByteArray,val headers: HttpHeaders)
    private fun call(op: String,method: HttpMethod,path: String,body: Any?=null,token: String?=ownerToken,status: Int=200,key: UUID=UUID.randomUUID(),raw: Boolean=false,media: String="application/json",validateRequest: Boolean=true,case: String="success",acceptedStatuses: Set<Int> = setOf(status)): Response {
        val bytes=when { body==null -> null;body is ByteArray -> body;raw -> (body as String).toByteArray();else -> mapper.writeValueAsBytes(body) }
        val requestId=UUID.randomUUID().toString()
        val headers=HttpHeaders().apply { contentType=MediaType.parseMediaType(media);set("X-Request-Id",requestId);set("Idempotency-Key",key.toString());token?.let(::setBearerAuth) }
        val response=http.exchange("/api/v1$path",method,HttpEntity(bytes,headers),ByteArray::class.java)
        val output=response.body ?: byteArrayOf();val json=response.headers.contentType?.isCompatibleWith(MediaType.APPLICATION_JSON)==true
        val value=if(json && output.isNotEmpty())mapper.readTree(output) else mapper.nullNode()
        val event=linkedMapOf<String,Any?>("operationId" to op,"method" to method.name(),"path" to "/api/v1$path","case" to case,"status" to response.statusCode.value(),"expectedStatus" to (if(response.statusCode.value() in acceptedStatuses)response.statusCode.value() else status),"statusMatches" to (response.statusCode.value() in acceptedStatuses),"validateRequest" to (validateRequest && status !in setOf(400,415)),
            "requestHeaders" to mapOf("Content-Type" to media,"Idempotency-Key" to key.toString(),"X-Request-Id" to requestId),"requestBody" to (if(media=="application/json" && bytes!=null)runCatching { mapper.readTree(bytes) }.getOrNull() else null),
            "responseHeaders" to response.headers.mapValues { it.value.joinToString(",") },"responseHeaderValues" to response.headers.toMap(),"responseBody" to (if(json)value else null),"responseBinaryBytes" to (if(json)null else output.size),"responseBinarySha256" to (if(json)null else sha(output)))
        events+=event
        assertTrue(response.statusCode.value() in acceptedStatuses,"$op $case expected $acceptedStatuses: ${response.statusCode.value()} $value")
        assertEquals(listOf(requestId),response.headers["X-Request-Id"],"single trace header")
        val cache=if(op in setOf("contentUploadImage","contentReadImage") && response.statusCode.value() in 200..299)"private, no-store" else "no-store"
        assertEquals(listOf(cache),response.headers["Cache-Control"],"single cache header")
        if(response.statusCode.value()>=400) { assertTrue(value["code"].isTextual);assertTrue(value["fieldErrors"].isArray);assertEquals(requestId,value["requestId"].asText()) }
        return Response(value,output,response.headers)
    }
    private fun post(op: String,path: String,body: Any?,token: String=ownerToken,status: Int=201,key: UUID=UUID.randomUUID())=call(op,HttpMethod.POST,path,body,token,status,key).value
    private fun put(op: String,path: String,body: Any?,token: String=ownerToken,status: Int=200,key: UUID=UUID.randomUUID())=call(op,HttpMethod.PUT,path,body,token,status,key).value
    private fun get(op: String,path: String,token: String=ownerToken,status: Int=200)=call(op,HttpMethod.GET,path,token=token,status=status).value
    private fun count(sql: String,vararg args: Any?)=jdbc.queryForObject(sql,Long::class.java,*args)!!
    private fun check(name: String,values: Map<String,Any?> = emptyMap()) { checks+=mapOf("check" to name,"status" to "PASS")+values }
    private fun sha(bytes: ByteArray)=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun doc(text: String="中文🌊 e\u0301\n原始换行",format: String="PLAIN")=mapOf("blocks" to listOf(mapOf("kind" to "TEXT","text" to text,"format" to format)))
    private fun payload(type: String="TRUE_FALSE",image: UUID?=null): Map<String,Any?> = linkedMapOf<String,Any?>("type" to type,"stem" to if(image==null)doc() else mapOf("blocks" to listOf(mapOf("kind" to "TEXT","text" to "中文图片与公式","format" to "MARKDOWN"),mapOf("kind" to "IMAGE","fileId" to image,"alt" to "波浪图 🌊"),mapOf("kind" to "LATEX","source" to "\\frac{1}{2}+\\alpha","display" to true))),"explanation" to doc("**说明**\n- 一\n- 二","MARKDOWN")).apply {
        when(type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> { put("options",listOf("a","b","c").map { mapOf("key" to it,"optionId" to null,"content" to doc(it)) });put("correctOptionKeys",if(type=="SINGLE_CHOICE")listOf("a") else listOf("a","b")) }
            "TRUE_FALSE" -> put("correctValue",true)
            "SHORT_ANSWER" -> put("referenceAnswer",doc("参考要点与公式"))
        }
    }
    private fun png(format: String="png"): ByteArray {
        val image=BufferedImage(3,2,BufferedImage.TYPE_INT_RGB);image.setRGB(0,0,0x145a82)
        return ByteArrayOutputStream().also { assertTrue(ImageIO.write(image,format,it));image.flush() }.toByteArray()
    }
    private fun subject(token: String=ownerToken,source: String="USER")=post("contentCreateSubject","/subjects",mapOf("source" to source,"title" to "  科目🌊e\u0301  ","description" to "内容验收"),token).uuid("subjectId")
    private fun cv(subject: UUID,token: String=ownerToken)=get("contentGetSubject","/subjects/$subject?view=MANAGE",token)["contentVersion"].asLong()
    private fun chapter(subject: UUID,token: String=ownerToken)=post("contentCreateChapter","/subjects/$subject/chapters",mapOf("expectedVersion" to cv(subject,token),"title" to "章节"),token).uuid("chapterId")
    private fun question(subject: UUID,chapter: UUID,type: String="TRUE_FALSE",image: UUID?=null,token: String=ownerToken,sourceKey: String?=null)=post("contentCreateQuestion","/subjects/$subject/chapters/$chapter/questions",mapOf("expectedVersion" to cv(subject,token),"question" to mapOf("sourceKey" to sourceKey,"content" to payload(type,image))),token)
    private fun batch(subject: UUID,chapter: UUID,questions: List<Any?>,token: String=ownerToken)=post("contentPrevalidateImport","/subjects/$subject/imports",mapOf("expectedVersion" to cv(subject,token),"documents" to listOf(mapOf("fileName" to "试题.json","schemaVersion" to "qanda-content-1","chapterId" to chapter,"questions" to questions))),token)
    private fun importQuestion(source: String?=null,type: String="TRUE_FALSE",image: UUID?=null)=mapOf("sourceKey" to source,"content" to payload(type,image))
    private fun upload(subject: UUID,bytes: ByteArray=png(),media: String="image/png",token: String=ownerToken,key: UUID=UUID.randomUUID(),status: Int=201)=call("contentUploadImage",HttpMethod.POST,"/subjects/$subject/images",bytes,token,status,key,media=media).value

    @BeforeAll fun seedRealProviders() {
        Files.createDirectories(target)
        assertEquals("qanda_backend",jdbc.queryForObject("SELECT current_database()",String::class.java))
        val address="content-operator@example.test"
        val challenge=call("identityRequestPublicEmailChallenge",HttpMethod.POST,"/auth/email-challenges",mapOf("purpose" to "REGISTER","email" to address),token=null,status=201).value
        val dispatcher=MailDispatcher(outbox,crypto,transport,context.getBeanProvider(IdentityService::class.java),tx,Clock.systemUTC())
        assertTrue(dispatcher.dispatchOne())
        fun captureJson(path: String): JsonNode {
            val result=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI("http://127.0.0.1:${capture.getMappedPort(8025)}$path")).GET().build(),HttpResponse.BodyHandlers.ofString())
            assertEquals(200,result.statusCode());return mapper.readTree(result.body())
        }
        val mail=captureJson("/api/v1/messages")["messages"].single { it["To"].any { to -> to["Address"].asText()==address } }
        val text=captureJson("/api/v1/message/"+mail["ID"].asText())["Text"].asText()
        val code=Regex("(?<![0-9])([0-9]{6})(?![0-9])").find(text)!!.groupValues[1]
        val result=bootstrap.bootstrap(challenge.uuid("challengeId"),code,identity.prepareLocalBootstrapPassword(password),"Content验收管理员",LocalOperatorProof("BOOTSTRAP",UUID.randomUUID()),UUID.randomUUID())
        adminId=result.accountId
        adminToken=call("identityCreateEmailSession",HttpMethod.POST,"/auth/sessions",mapOf("email" to address,"password" to password,"clientType" to "ADMIN_WEB","deviceId" to UUID.randomUUID()),token=null,status=201).value["accessToken"].asText()
        college=post("authorizationCreateCollege","/admin/colleges",mapOf("name" to "验收学院"),adminToken).uuid("resourceId")
        major=post("authorizationCreateMajor","/admin/colleges/$college/majors",mapOf("name" to "验收专业"),adminToken).uuid("resourceId")
        fun register(n: Int): Pair<JsonNode,String> {
            fun login()=call("identityCreateWechatSession",HttpMethod.POST,"/auth/wechat-sessions",mapOf("code" to "local-learner-$n:${UUID.randomUUID()}","clientType" to "MINI_PROGRAM","deviceId" to UUID.randomUUID()),token=null).value
            val registration=call("identityRegisterWechat",HttpMethod.POST,"/auth/wechat-registrations",mapOf("registrationToken" to login()["registrationToken"].asText(),"collegeId" to college,"majorId" to major),token=null,status=201).value
            return registration to login()["accessToken"].asText()
        }
        val owner=register(1);ownerId=owner.first.uuid("accountId");ownerToken=owner.second
        val viewer=register(2);viewerId=viewer.first.uuid("accountId");viewerCode=viewer.first["accountCode"].asText();viewerToken=viewer.second
        otherToken=register(3).second
        check("Real identity, authorization, admin audit, local SMTP capture and BinaryAssetPort enabled; no provider replacement")
    }
    @Test @Order(1) fun `all 23 public operations return real success data and retained revisions`() {
        val subject=subject();val initial=get("contentGetSubject","/subjects/$subject?view=MANAGE")
        assertEquals(ownerId.toString(),initial["ownerAccountId"].asText());assertEquals("科目🌊é",initial["title"].asText())
        val first=chapter(subject);val second=chapter(subject)
        put("contentUpdateChapter","/subjects/$subject/chapters/$first",mapOf("expectedVersion" to 1,"title" to "第一章修订","status" to "ACTIVE"))
        put("contentReorderChapters","/subjects/$subject/chapter-order",mapOf("expectedVersion" to cv(subject),"ids" to listOf(second,first)))
        val chapters=get("contentListChapters","/subjects/$subject/chapters?view=MANAGE")
        assertEquals(second.toString(),chapters["items"][0]["id"].asText())
        val image=upload(subject);val file=image.uuid("fileId")
        assertEquals("image/png",image["mediaType"].asText());assertEquals(3,image["widthPixels"].asInt());assertEquals(2,image["heightPixels"].asInt())
        val created=listOf("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER").mapIndexed { i,t -> question(subject,first,t,if(i==0)file else null,sourceKey="four-$i") }
        val original=get("contentGetQuestion","/subjects/$subject/questions/${created[0].uuid("questionId")}")
        val q=original.uuid("id");val oldRevision=original.uuid("revisionId")
        assertEquals("中文图片与公式",original["payload"]["stem"]["blocks"][0]["text"].asText())
        val options=original["payload"]["options"].mapIndexed { i,o -> mapOf("key" to "k$i","optionId" to o["optionId"].asText(),"content" to o["content"]) }
        val revised=put("contentReviseQuestion","/subjects/$subject/questions/$q",mapOf("expectedVersion" to 1,"content" to payload("SINGLE_CHOICE",file)+mapOf("stem" to doc("修订后🌊"),"options" to options,"correctOptionKeys" to listOf("k1"))))
        assertEquals(2,revised["version"].asInt())
        val historic=get("contentGetManagedRevision","/subjects/$subject/questions/$q/revisions/$oldRevision")
        assertEquals(original["payload"],historic["payload"])
        val current=get("contentGetQuestion","/subjects/$subject/questions/$q")
        assertEquals(original["payload"]["options"].map { it["optionId"] },current["payload"]["options"].map { it["optionId"] })
        put("contentReorderQuestions","/subjects/$subject/chapters/$first/question-order",mapOf("expectedVersion" to cv(subject),"ids" to created.reversed().map { it.uuid("questionId") }))
        val questions=get("contentListQuestions","/subjects/$subject/chapters/$first/questions?view=MANAGE")
        assertEquals(4,questions["totalItems"].asInt());assertEquals(created.last()["questionId"],questions["items"][0]["id"])
        assertEquals(1,get("contentListQuestions","/subjects/$subject/chapters/$first/questions?type=SHORT_ANSWER")["totalItems"].asInt())
        assertTrue(get("contentSearchQuestions","/subjects/$subject/question-search?q=参考要点")["totalItems"].asInt()>0)
        val inactive=created[2].uuid("questionId")
        put("contentSetQuestionStatus","/subjects/$subject/questions/$inactive/status",mapOf("expectedVersion" to 1,"status" to "INACTIVE"))
        get("contentGetQuestion","/subjects/$subject/questions/$inactive",status=404)
        put("contentSetQuestionStatus","/subjects/$subject/questions/$inactive/status",mapOf("expectedVersion" to 2,"status" to "ACTIVE"))
        val preview=batch(subject,second,listOf(importQuestion("import-one","SHORT_ANSWER")))
        assertEquals("VALID",preview["state"].asText())
        put("contentUpdateSubject","/subjects/$subject",mapOf("expectedVersion" to 1,"title" to "更新后的科目","description" to "新说明"))
        // A metadata edit invalidates a prevalidation snapshot through the aggregate version.
        post("contentCommitImport","/subjects/$subject/imports/${preview.uuid("id")}/commit",mapOf("expectedVersion" to 1),status=409)
        val valid=batch(subject,second,listOf(importQuestion("import-one","SHORT_ANSWER")))
        post("contentCommitImport","/subjects/$subject/imports/${valid.uuid("id")}/commit",mapOf("expectedVersion" to 1),status=200)
        assertEquals("COMMITTED",get("contentGetImport","/subjects/$subject/imports/${valid.uuid("id")}")["state"].asText())
        val cancelled=batch(subject,second,listOf(importQuestion("cancel-one")))
        post("contentCancelImport","/subjects/$subject/imports/${cancelled.uuid("id")}/cancel",mapOf("expectedVersion" to 1),status=200)
        assertEquals("CANCELLED",get("contentGetImport","/subjects/$subject/imports/${cancelled.uuid("id")}")["state"].asText())
        val binary=call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$file?view=MANAGE")
        assertEquals(image["sizeBytes"].asLong(),binary.bytes.size.toLong());assertEquals("image/png",binary.headers.contentType.toString());assertEquals(png().size,binary.bytes.size)
        call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$file?revisionId=$oldRevision",status=404)
        call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$file?view=MANAGE&revisionId=$oldRevision")
        call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$file",status=400)
        put("contentSetSubjectStatus","/subjects/$subject/status",mapOf("expectedVersion" to 2,"status" to "INACTIVE"))
        get("contentGetSubject","/subjects/$subject",status=409)
        get("contentGetSubject","/subjects/$subject?view=MANAGE")
        put("contentSetSubjectStatus","/subjects/$subject/status",mapOf("expectedVersion" to 3,"status" to "ACTIVE"))
        assertTrue(get("contentListSubjects","/subjects?view=MANAGE&source=USER")["totalItems"].asInt()>0)
        assertEquals(23,events.filter { it["operationId"].toString().startsWith("content") && (it["status"] as Int) in 200..299 }.map { it["operationId"] }.distinct().size)
        check("23 operation success paths, four types, Unicode/NFC, formulas, history, current versus managed image references")
    }

    @Test @Order(2) fun `SCHOOL qualification and USER ownership sharing revocation isolate all body reads`() {
        val school=subject(adminToken,"SCHOOL");val ch=chapter(school,adminToken)
        val q=question(school,ch,token=adminToken).uuid("questionId")
        get("contentGetSubject","/subjects/$school?view=MANAGE",adminToken)
        get("contentGetSubject","/subjects/$school",ownerToken,404)
        get("contentGetSubject","/subjects/$school?view=MANAGE",ownerToken,403)
        put("authorizationSetSchoolPublic","/admin/subjects/$school/school-access",mapOf("isPublic" to true,"expectedVersion" to 1),adminToken)
        get("contentGetQuestion","/subjects/$school/questions/$q",ownerToken)
        val personal=subject();val personalChapter=chapter(personal);val image=upload(personal).uuid("fileId")
        val question=question(personal,personalChapter,image=image);val questionId=question.uuid("questionId");val revision=question.uuid("revisionId")
        get("contentGetSubject","/subjects/$personal?view=MANAGE",adminToken,404)
        get("contentGetQuestion","/subjects/$personal/questions/$questionId?view=MANAGE",adminToken,404)
        get("contentListSubjects","/subjects?view=MANAGE&source=USER",adminToken).also { assertTrue(it["items"].none { row -> row["id"].asText()==personal.toString() }) }
        get("contentListChapters","/subjects/$personal/chapters",otherToken,404)
        get("contentSearchQuestions","/subjects/$personal/question-search?q=中文",otherToken,404)
        get("contentGetManagedRevision","/subjects/$personal/questions/$questionId/revisions/$revision",otherToken,404)
        call("contentReadImage",HttpMethod.GET,"/subjects/$personal/images/$image?view=MANAGE",token=adminToken,status=404)
        post("authorizationGrantUserSubjectShare","/subjects/$personal/shares",mapOf("accountCode" to viewerCode,"expectedVersion" to 1),status=200)
        get("contentGetQuestion","/subjects/$personal/questions/$questionId",viewerToken)
        call("contentReadImage",HttpMethod.GET,"/subjects/$personal/images/$image?revisionId=$revision",token=viewerToken)
        get("contentGetQuestion","/subjects/$personal/questions/$questionId?view=MANAGE",viewerToken,404)
        post("authorizationRevokeUserSubjectShare","/subjects/$personal/share-revocations",mapOf("recipientAccountId" to viewerId,"expectedVersion" to 2),status=200)
        get("contentGetQuestion","/subjects/$personal/questions/$questionId",viewerToken,404)
        call("contentReadImage",HttpMethod.GET,"/subjects/$personal/images/$image?revisionId=$revision",token=viewerToken,status=404)
        put("authorizationSetSchoolPublic","/admin/subjects/$school/school-access",mapOf("isPublic" to false,"expectedVersion" to 2),adminToken)
        get("contentGetQuestion","/subjects/$school/questions/$q",ownerToken,404)
        check("SCHOOL management without membership, qualified access, USER owner-only editing, share/read/revoke and admin privacy")
    }

    @Test @Order(3) fun `raw command retry is stable and concurrent sorting has one CAS winner`() {
        val subject=subject();val ch=chapter(subject);val second=chapter(subject);val third=chapter(subject)
        val command=UUID.randomUUID();val body=mapOf("expectedVersion" to cv(subject),"question" to importQuestion("stable"))
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val tasks=(1..2).map { pool.submit<JsonNode> { start.await();post("contentCreateQuestion","/subjects/$subject/chapters/$ch/questions",body,key=command) } }
            start.countDown();val results=tasks.map { it.get(20,TimeUnit.SECONDS) };assertEquals(results[0],results[1])
            val same=post("contentCreateQuestion","/subjects/$subject/chapters/$ch/questions",body,key=command);assertEquals(results[0],same)
            assertEquals(1,count("SELECT count(*) FROM content_question WHERE subject_id=?",subject))
            assertEquals(1,count("SELECT count(*) FROM admin_audit_entry WHERE source_module='CONTENT' AND target_id=?",same.uuid("questionId")))
            assertEquals("IDEMPOTENCY_CONFLICT",post("contentCreateQuestion","/subjects/$subject/chapters/$ch/questions",body+mapOf("expectedVersion" to 999),status=409,key=command)["code"].asText())
            assertEquals("IDEMPOTENCY_CONFLICT",call("contentCreateQuestion",HttpMethod.POST,"/subjects/$subject/chapters/$ch/questions",mapper.writeValueAsString(body)+" ",status=409,key=command,raw=true,case="original-bytes-differ").value["code"].asText())
            val current=cv(subject);val go=CountDownLatch(1)
            val sorts=listOf(listOf(third,ch,second),listOf(second,third,ch)).map { ids -> pool.submit<Int> {
                go.await()
                val response=call("contentReorderChapters",HttpMethod.PUT,"/subjects/$subject/chapter-order",mapOf("expectedVersion" to current,"ids" to ids),acceptedStatuses=setOf(200,409),case="concurrent-sort")
                if(response.value.has("code"))409 else 200
            } }
            go.countDown();val statuses=sorts.map { it.get(20,TimeUnit.SECONDS) }
            assertEquals(listOf(200,409),statuses.sorted())
            assertEquals(current+1,cv(subject))
            assertEquals(listOf(1,2,3),jdbc.queryForList("SELECT position FROM content_chapter WHERE subject_id=? ORDER BY position",Int::class.java,subject))
            check("Idempotency serializes concurrent identical raw requests and rejects mismatched payloads",mapOf("sameCommandReplies" to 3,"formalQuestions" to 1,"sortStatuses" to statuses))
        } finally { pool.shutdownNow() }
    }
    @Test @Order(4) fun `JSON prevalidation distinguishes shape failures and invalid batches and import rollback is atomic`() {
        val subject=subject();val ch=chapter(subject);val before=count("SELECT count(*) FROM content_import_batch WHERE subject_id=?",subject)
        val malformed=mapOf("expectedVersion" to cv(subject),"documents" to listOf(mapOf("fileName" to "bad.json","schemaVersion" to "qanda-content-1","chapterId" to ch,"questions" to listOf(mapOf("content" to payload()+mapOf("correctValue" to "true"))))))
        call("contentPrevalidateImport",HttpMethod.POST,"/subjects/$subject/imports",malformed,status=400,validateRequest=false,case="invalid-json-field-type")
        assertEquals(before,count("SELECT count(*) FROM content_import_batch WHERE subject_id=?",subject))
        val invalid=batch(subject,ch,listOf(mapOf("sourceKey" to null,"content" to payload("SINGLE_CHOICE")+mapOf("correctOptionKeys" to listOf("missing")))))
        assertEquals("INVALID",invalid["state"].asText());assertEquals(1,invalid["issues"].size());assertEquals(0,count("SELECT count(*) FROM content_question WHERE subject_id=?",subject))
        post("contentCommitImport","/subjects/$subject/imports/${invalid.uuid("id")}/commit",mapOf("expectedVersion" to 1),status=422)
        val duplicate=batch(subject,ch,listOf(importQuestion("duplicate"),importQuestion("duplicate")))
        assertEquals("INVALID",duplicate["state"].asText());assertTrue(duplicate["issues"].any { it["code"].asText()=="IMPORT_SOURCE_CONFLICT" })
        val valid=batch(subject,ch,listOf(importQuestion("atomic-one","SINGLE_CHOICE"),importQuestion("atomic-two","SHORT_ANSWER")))
        val snapshot=listOf("content_question","content_question_revision","content_option_identity","content_revision_attachment","content_import_created_question","content_command_receipt").associateWith { count("SELECT count(*) FROM $it") }
        val id=valid.uuid("id");val command=UUID.randomUUID()
        installAuditFailure()
        try { post("contentCommitImport","/subjects/$subject/imports/$id/commit",mapOf("expectedVersion" to 1),status=503,key=command) }
        finally { removeAuditFailure() }
        for((table,number) in snapshot)assertEquals(number,count("SELECT count(*) FROM $table"),table)
        assertEquals("VALID",get("contentGetImport","/subjects/$subject/imports/$id")["state"].asText())
        val committed=post("contentCommitImport","/subjects/$subject/imports/$id/commit",mapOf("expectedVersion" to 1),status=200,key=command)
        assertEquals(committed,post("contentCommitImport","/subjects/$subject/imports/$id/commit",mapOf("expectedVersion" to 1),status=200,key=command))
        post("contentCommitImport","/subjects/$subject/imports/$id/commit",mapOf("expectedVersion" to 2),status=409)
        assertEquals(2,count("SELECT count(*) FROM content_question WHERE subject_id=?",subject))
        assertEquals(1,count("SELECT count(*) FROM admin_audit_entry WHERE source_module='CONTENT' AND action='CONTENT_IMPORT_COMMITTED' AND target_id=?",id))
        val expired=batch(subject,ch,listOf(importQuestion("expired")));jdbc.update("UPDATE content_import_batch SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=?",expired.uuid("id"))
        post("contentCommitImport","/subjects/$subject/imports/${expired.uuid("id")}/commit",mapOf("expectedVersion" to 1),status=409)
        val foreign=subject(viewerToken);val foreignChapter=chapter(foreign,viewerToken)
        assertEquals("INVALID",batch(subject,foreignChapter,listOf(importQuestion()))["state"].asText())
        get("contentGetImport","/subjects/$subject/imports/$id",viewerToken,404)
        check("Shape failure creates no batch; invalid source/answer/chapter saved as INVALID; commit atomic rollback and replay",mapOf("failedCommitTableCountsUnchanged" to snapshot,"committedQuestions" to 2,"batchAuditEvents" to 1))
    }
    private fun installAuditFailure() {
        jdbc.execute("CREATE OR REPLACE FUNCTION content_acceptance_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_module='CONTENT' THEN RAISE EXCEPTION 'Content acceptance injected audit failure'; END IF; RETURN NEW; END $$")
        jdbc.execute("CREATE TRIGGER content_acceptance_fail_audit BEFORE INSERT ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION content_acceptance_fail_audit()")
    }
    private fun removeAuditFailure() { jdbc.execute("DROP TRIGGER IF EXISTS content_acceptance_fail_audit ON admin_audit_entry");jdbc.execute("DROP FUNCTION IF EXISTS content_acceptance_fail_audit()") }

    @Test @Order(5) fun `real PNG JPEG WebP bytes use canonical output outside locks with idempotent recovery and corruption refusal`() {
        val subject=subject();val ch=chapter(subject)
        val webp=Base64.getDecoder().decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQrVJUsP+BiOh/AAA=")
        val results=listOf("image/png" to png(),"image/jpeg" to png("jpeg"),"image/webp" to webp).map { (media,bytes) ->
            val command=UUID.randomUUID();val image=upload(subject,bytes,media,key=command)
            val replay=upload(subject,bytes,media,key=command);assertEquals(image,replay)
            assertEquals("image/png",image["mediaType"].asText())
            val file=image.uuid("fileId");val question=question(subject,ch,image=file)
            val read=call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$file?revisionId=${question.uuid("revisionId")}")
            assertEquals(image["sizeBytes"].asLong(),read.bytes.size.toLong());assertEquals(read.bytes.size.toLong(),read.headers.contentLength)
            val decoded=ImageIO.read(read.bytes.inputStream());assertEquals(image["widthPixels"].asInt(),decoded.width);assertEquals(image["heightPixels"].asInt(),decoded.height);decoded.flush()
            assertEquals(jdbc.queryForObject("SELECT sha256 FROM file_asset WHERE id=?",String::class.java,file),sha(read.bytes))
            upload(subject,bytes+0.toByte(),media,key=command,status=409)
            check("Actual input/output image",mapOf("inputMediaType" to media,"outputMediaType" to image["mediaType"].asText(),"outputBytes" to read.bytes.size,"dimensions" to listOf(image["widthPixels"].asInt(),image["heightPixels"].asInt())))
            image
        }
        val malformed=UUID.randomUUID();upload(subject,"invalid image".toByteArray(),key=malformed,status=415)
        upload(subject,"invalid image".toByteArray(),key=malformed,status=415)
        assertEquals("REJECTED",jdbc.queryForObject("SELECT state FROM content_command_receipt WHERE command_request_id=?",String::class.java,malformed))
        val failed=UUID.randomUUID();val before=cv(subject)
        installAuditFailure()
        try { upload(subject,key=failed,status=503) } finally { removeAuditFailure() }
        val operation=jdbc.queryForObject("SELECT upload_operation_id FROM content_command_receipt WHERE command_request_id=?",UUID::class.java,failed)!!
        val staged=assets.readStage(operation,AssetActor(ownerId),ImageLimits(subject,"image/png"))!!.ready!!
        assertEquals(before,cv(subject));assertEquals(0,count("SELECT count(*) FROM content_image WHERE file_id=?",staged.fileId))
        val retried=upload(subject,key=failed);assertEquals(staged.fileId,retried.uuid("fileId"))
        val first=results.first().uuid("fileId");val key=jdbc.queryForObject("SELECT storage_key FROM file_asset WHERE id=?",String::class.java,first)!!
        val path=assetRoot.resolve("objects").resolve(key);val bytes=Files.readAllBytes(path)
        try {
            Files.write(path,bytes+byteArrayOf(0));call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$first?view=MANAGE",status=503)
            Files.delete(path);call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$first?view=MANAGE",status=503)
        } finally { Files.write(path,bytes) }
        val unknown=object: AssetAccessContext { override val fileId=first;override val subjectId=subject }
        val denied=assertThrows(ApiException::class.java) { tx.required { assets.prepareReadInTransaction(unknown) } }
        assertEquals("FILE_ACCESS_POLICY_UNAVAILABLE",denied.code)
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive())
        check("Full HTTP read proves open ran after transaction; missing/corrupted assets refused; READY survives failed binding/audit and retries same file",mapOf("recoveredFileId" to staged.fileId,"auditFailureReceipt" to "RESERVED","unknownContextCode" to denied.code))
    }

    @Test @Order(6) fun `validated composite keys enforce subject attachment ownership and immutable history retention`() {
        val subject=subject();val ch=chapter(subject);val file=upload(subject).uuid("fileId");val question=question(subject,ch,image=file)
        val foreign=subject();val otherFile=upload(foreign).uuid("fileId")
        fun reject(name: String,sqlState: String,block: ()->Unit) {
            val error=assertThrows(org.springframework.dao.DataAccessException::class.java) { tx.required { block();Unit } }
            val actual=generateSequence<Throwable>(error){it.cause}.filterIsInstance<SQLException>().first().sqlState
            assertEquals(sqlState,actual,name);check(name,mapOf("sqlState" to actual))
        }
        reject("USER subject cannot have a null owner","23514") { jdbc.update("INSERT INTO content_subject(id,source,title,created_by,created_at,updated_at) VALUES(?,'USER','invalid owner',?,clock_timestamp(),clock_timestamp())",UUID.randomUUID(),ownerId) }
        val validated=jdbc.queryForMap("SELECT convalidated,confdeltype::text FROM pg_constraint WHERE conname='content_image_asset_fk'")
        assertEquals(true,validated["convalidated"]);assertEquals("r",validated["confdeltype"])
        reject("Image FK rejects orphan","23503") { jdbc.update("INSERT INTO content_image VALUES(?,?,clock_timestamp())",UUID.randomUUID(),subject) }
        reject("Image FK rejects another subject's asset","23503") { jdbc.update("UPDATE content_image SET subject_id=? WHERE file_id=?",subject,otherFile) }
        reject("Referenced historical image is retained","23503") { jdbc.update("DELETE FROM content_image WHERE file_id=?",file) }
        reject("Revision payload immutable","P0001") { jdbc.update("UPDATE content_question_revision SET payload='{}'::jsonb WHERE id=?",question.uuid("revisionId")) }
        reject("Stable option registry and revision attachment immutable","P0001") { jdbc.update("DELETE FROM content_revision_attachment WHERE revision_id=?",question.uuid("revisionId")) }
        reject("Subject owner immutable","P0001") { jdbc.update("UPDATE content_subject SET owner_account_id=? WHERE id=?",viewerId,subject) }
        val before=count("SELECT count(*) FROM content_question WHERE subject_id=?",subject)
        call("contentCreateQuestion",HttpMethod.POST,"/subjects/$subject/chapters/$ch/questions",mapOf("expectedVersion" to cv(subject),"question" to importQuestion(image=otherFile)),status=422)
        assertEquals(before,count("SELECT count(*) FROM content_question WHERE subject_id=?",subject))
        val batch=batch(subject,ch,listOf(importQuestion(image=otherFile)));assertEquals("INVALID",batch["state"].asText())
        val constraints=jdbc.queryForList("SELECT conname,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid IN ('content_question'::regclass,'content_question_revision'::regclass,'content_image'::regclass) ORDER BY conname")
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("sql-constraints.json").toFile(),constraints)
        check("Validated image composite FK and question/revision UK targets",mapOf("imageFkValidated" to true,"imageFkDeleteAction" to "RESTRICT"))
    }

    @Test @Order(7) fun `all public operations expose documented errors and strict JSON invalid data never writes`() {
        val subject=subject();val ch=chapter(subject);val q=question(subject,ch);val id=q.uuid("questionId");val batch=batch(subject,ch,listOf(importQuestion()))
        val notFound=UUID.randomUUID()
        get("contentListSubjects","/subjects?page=0",status=400)
        call("contentCreateSubject",HttpMethod.POST,"/subjects",mapOf("source" to "USER","title" to 7),status=400,validateRequest=false,case="number-title")
        get("contentGetSubject","/subjects/$notFound",status=404)
        put("contentUpdateSubject","/subjects/$subject",mapOf("expectedVersion" to 999,"title" to "旧版本","description" to ""),status=409)
        put("contentSetSubjectStatus","/subjects/$subject/status",mapOf("expectedVersion" to 999,"status" to "INACTIVE"),status=409)
        get("contentListChapters","/subjects/$notFound/chapters",status=404)
        post("contentCreateChapter","/subjects/$subject/chapters",mapOf("expectedVersion" to 999,"title" to "旧版本"),status=409)
        put("contentUpdateChapter","/subjects/$subject/chapters/$notFound",mapOf("expectedVersion" to 1,"title" to "不存在","status" to "ACTIVE"),status=404)
        put("contentReorderChapters","/subjects/$subject/chapter-order",mapOf("expectedVersion" to cv(subject),"ids" to listOf(notFound)),status=422)
        get("contentListQuestions","/subjects/$subject/chapters/$notFound/questions",status=404)
        post("contentCreateQuestion","/subjects/$subject/chapters/$ch/questions",mapOf("expectedVersion" to 999,"question" to importQuestion()),status=409)
        put("contentReorderQuestions","/subjects/$subject/chapters/$ch/question-order",mapOf("expectedVersion" to cv(subject),"ids" to listOf(notFound)),status=422)
        get("contentGetQuestion","/subjects/$subject/questions/$notFound",status=404)
        put("contentReviseQuestion","/subjects/$subject/questions/$id",mapOf("expectedVersion" to 999,"content" to payload()),status=409)
        put("contentSetQuestionStatus","/subjects/$subject/questions/$id/status",mapOf("expectedVersion" to 999,"status" to "INACTIVE"),status=409)
        get("contentGetManagedRevision","/subjects/$subject/questions/$id/revisions/$notFound",status=404)
        get("contentSearchQuestions","/subjects/$notFound/question-search?q=hello",status=404)
        post("contentPrevalidateImport","/subjects/$subject/imports",mapOf("expectedVersion" to 999,"documents" to listOf(mapOf("fileName" to "x.json","schemaVersion" to "qanda-content-1","chapterId" to ch,"questions" to listOf(importQuestion())))),status=409)
        get("contentGetImport","/subjects/$subject/imports/$notFound",status=404)
        post("contentCommitImport","/subjects/$subject/imports/${batch.uuid("id")}/commit",mapOf("expectedVersion" to 999),status=409)
        post("contentCancelImport","/subjects/$subject/imports/${batch.uuid("id")}/cancel",mapOf("expectedVersion" to 999),status=409)
        upload(subject,token=otherToken,status=404)
        call("contentReadImage",HttpMethod.GET,"/subjects/$subject/images/$notFound?view=MANAGE",status=404)
        val before=count("SELECT count(*) FROM content_command_receipt")
        for(raw in listOf("{", "{\"source\":\"USER\",\"title\":\"x\",\"ownerAccountId\":\"$viewerId\"}","{\"source\":\"USER\",\"title\":\"x\",\"title\":\"y\"}","null","[]"))call("contentCreateSubject",HttpMethod.POST,"/subjects",raw,raw=true,status=400,validateRequest=false,case="malformed-or-extra-json")
        call("contentCreateSubject",HttpMethod.POST,"/subjects","text",raw=true,media="text/plain",status=415,validateRequest=false,case="wrong-json-media")
        call("contentCreateSubject",HttpMethod.POST,"/subjects",mapOf("source" to "USER","title" to ""),status=422,validateRequest=false,case="invalid-title")
        call("contentCreateSubject",HttpMethod.POST,"/subjects",mapOf("source" to "USER","title" to "x"),token=null,status=401,case="missing-authentication")
        call("contentCreateSubject",HttpMethod.POST,"/subjects",("{\"source\":\"USER\",\"title\":\"x\"}"+" ".repeat(5242880)),raw=true,status=413,validateRequest=false,case="json-body-limit")
        upload(subject,ByteArray(5242881),status=413)
        get("contentGetSubject","/subjects/1-1-1-1-1",status=400)
        get("contentListSubjects","/subjects?page=1&page=2",status=400)
        get("contentListSubjects","/subjects?unexpected=true",status=400)
        assertEquals(before,count("SELECT count(*) FROM content_command_receipt"))
        check("23 distinct operation error paths with unified error and single headers; invalid JSON/types/media/CAS leave no receipts")
    }
    @Test @Order(8) fun `file access capabilities expire across transactions and issued references stay immutable after retirement`() {
        val subject=subject();val ch=chapter(subject);val file=upload(subject).uuid("fileId");val question=question(subject,ch,image=file)
        fun <T:Any> asOwner(block: ()->T): T {
            val auth=identityGuards.authenticate(ownerToken,Clock.systemUTC().instant())
            SecurityContextHolder.getContext().authentication=UsernamePasswordAuthenticationToken(auth,null,emptyList())
            return try { block() } finally { SecurityContextHolder.clearContext() }
        }
        lateinit var access: ContentFileAccessContext
        val prepared=asOwner { tx.required {
            val actor=identities.currentActor();val accounts=identities.lockAccountsAndSessionInTransaction(actor,mapOf(actor.accountId to GuardMode.SHARE)) as qanda.backend.identity.api.AuthorizationIdentityGuards
            val org=authorization.prepareAccessInTransaction(actor,accounts);val guard=content.lockSubjectsInTransaction(listOf(SubjectLock(subject))).single();val descriptor=content.describeLocked(guard)
            val verdict=authorization.evaluateLocked(actor,accounts,org,guard,descriptor,AccessAction.READ_CURRENT_CONTENT)
            access=ContentFileAccessContext(file,subject,actor,accounts,org,guard,verdict,null,ContentView.LEARN,question.uuid("revisionId"),Clock.systemUTC().instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS))
            assertThrows(IllegalStateException::class.java) { readPolicy.validateReadInTransaction(access,access.verifiedAt.plusSeconds(6)) }
            assets.prepareReadInTransaction(access)
        } }
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive())
        assets.open(prepared).use { assertTrue(it.stream.readAllBytes().isNotEmpty()) }
        assertEquals("FILE_ACCESS_CONTEXT_EXPIRED",assertThrows(ApiException::class.java) { assets.open(prepared) }.code)
        assertThrows(IllegalStateException::class.java) { tx.required { assets.prepareReadInTransaction(access) } }
        put("contentSetSubjectStatus","/subjects/$subject/status",mapOf("expectedVersion" to 1,"status" to "INACTIVE"))
        asOwner { tx.required {
            val actor=identities.currentActor();val accounts=identities.lockAccountsAndSessionInTransaction(actor,mapOf(actor.accountId to GuardMode.SHARE))
            val org=authorization.prepareAccessInTransaction(actor,accounts);val guard=content.lockSubjectsInTransaction(listOf(SubjectLock(subject))).single();val d=content.describeLocked(guard)
            val verdict=authorization.evaluateLocked(actor,accounts,org,guard,d,AccessAction.READ_FIXED_SESSION_RESULT)
            identityGuards.advanceLockPhaseInTransaction(40)
            val read=content.readIssuedRevisionsInTransaction(guard,verdict,listOf(IssuedRevisionReference(question.uuid("questionId"),question.uuid("revisionId"))))
            assertEquals(question.uuid("revisionId"),read.single().revisionId)
            val history=authorization.evaluateLocked(actor,accounts,org,guard,d,AccessAction.READ_LEARNING_HISTORY)
            val scope=content.currentQuestionScopeForQuery(listOf(guard),listOf(history))
            scope.assertCurrentTransaction()
            assertEquals(false,jdbc.queryForMap(scope.relationSql,*scope.parameters.toTypedArray())["active_for_new_selection"])
            Unit
        } }
        check("Fresh transaction-bound file access, five-second freshness, single-use prepared read and retained issued references after L40 without earlier locks")
    }

    @Test @Order(9) fun `prevalidation is reauthorized at commit and commit cancel racing cannot partially insert`() {
        put("adminSecuritySetQualification","/admin/administrators/$ownerId/qualification",mapOf("qualified" to true,"expectedVersion" to null),adminToken)
        try {
            val school=subject(ownerToken,"SCHOOL");val ch=chapter(school);val preview=batch(school,ch,listOf(importQuestion("qualification-change")))
            put("adminSecuritySetQualification","/admin/administrators/$ownerId/qualification",mapOf("qualified" to false,"expectedVersion" to 1),adminToken)
            post("contentCommitImport","/subjects/$school/imports/${preview.uuid("id")}/commit",mapOf("expectedVersion" to 1),status=403)
            assertEquals(0,count("SELECT count(*) FROM content_question WHERE subject_id=?",school))
            assertEquals("VALID",jdbc.queryForObject("SELECT state FROM content_import_batch WHERE id=?",String::class.java,preview.uuid("id")))
        } finally {
            if(jdbc.queryForObject("SELECT qualified FROM admin_qualification WHERE account_id=?",Boolean::class.java,ownerId)==true)put("adminSecuritySetQualification","/admin/administrators/$ownerId/qualification",mapOf("qualified" to false,"expectedVersion" to 1),adminToken)
        }
        val subject=subject();val chapter=chapter(subject);val preview=batch(subject,chapter,listOf(importQuestion("race")))
        val start=CountDownLatch(1);val pool=Executors.newFixedThreadPool(2)
        try {
            val tasks=listOf("commit","cancel").map { action -> pool.submit<Int> {
                start.await();val op=if(action=="commit")"contentCommitImport" else "contentCancelImport"
                val response=call(op,HttpMethod.POST,"/subjects/$subject/imports/${preview.uuid("id")}/$action",mapOf("expectedVersion" to 1),acceptedStatuses=setOf(200,409),case="commit-cancel-race")
                if(response.value.has("code"))409 else 200
            } }
            start.countDown();assertEquals(listOf(200,409),tasks.map { it.get(20,TimeUnit.SECONDS) }.sorted())
            val result=get("contentGetImport","/subjects/$subject/imports/${preview.uuid("id")}")
            val expected=if(result["state"].asText()=="COMMITTED")1L else 0L
            assertEquals(expected,count("SELECT count(*) FROM content_question WHERE subject_id=?",subject));assertEquals(expected,result["createdQuestions"].size().toLong())
            check("Commit rechecks current admin qualification and batch state; commit/cancel race has one terminal winner",mapOf("terminalState" to result["state"].asText(),"insertedQuestions" to expected))
        } finally { pool.shutdownNow() }
    }
    @Test @Order(10) fun `platform pre security invalid UTF8 errors retain a single no store header`() {
        call("contentCreateSubject",HttpMethod.POST,"/subjects",byteArrayOf(0xc3.toByte(),0x28),status=400,validateRequest=false,case="invalid-utf8")
    }
    private fun redact(value: JsonNode,key: String=""): JsonNode {
        if(key.lowercase() in setOf("password","newpassword","accesstoken","registrationtoken","authorization","oldcode","newcode") || key=="code" && value.isTextual && !value.asText().matches(Regex("[A-Z][A-Z0-9_]+")))return mapper.nodeFactory.textNode("[REDACTED]")
        if(value.isObject)return mapper.createObjectNode().also { output -> value.properties().forEach { (name,child) -> output.set<JsonNode>(name,redact(child,name)) } }
        if(value.isArray)return mapper.createArrayNode().also { output -> value.forEach { output.add(redact(it,key)) } }
        return value
    }
    @AfterAll fun preserveEvidenceAndStop() {
        try {
            Files.createDirectories(target)
            val all=events.toList();val content=all.filter { it["operationId"].toString().startsWith("content") }
            val python=Path.of(".backend-runtime/verification/quality/tools/python/bin/python").toAbsolutePath()
            assertTrue(Files.isExecutable(python),"Existing pinned QA schema runtime required")
            val process=ProcessBuilder(python.toString(),"src/test/kotlin/qanda/backend/content/validate-runtime.py").redirectErrorStream(true).apply { environment()["PYTHONDONTWRITEBYTECODE"]="1" }.start()
            process.outputStream.use { mapper.writeValue(it,all) }
            val output=process.inputStream.bufferedReader().readText();val code=process.waitFor()
            Files.writeString(target.resolve("http-schema-validation.json"),output.replace(System.getProperty("user.home"),"~"))
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("http-redacted.json").toFile(),redact(mapper.valueToTree(all)))
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("assertions.json").toFile(),mapOf("database" to "independent empty PostgreSQL17.6/qanda_backend Testcontainers","providers" to "real identity/authorization/admin/BinaryAssetPort, real local SMTP Mailpit; explicit local test WeChat","checks" to checks,"headerFailures" to all.filter { e ->
                val headers=e["responseHeaderValues"] as Map<*,*>
                val expected=if(e["operationId"] in setOf("contentUploadImage","contentReadImage") && (e["status"] as Int) in 200..299)"private, no-store" else "no-store"
                (headers.entries.firstOrNull { it.key.toString().equals("Cache-Control",true) }?.value as? List<*>)!=listOf(expected)
            }.map { mapOf("operationId" to it["operationId"],"case" to it["case"],"status" to it["status"],"owner" to "platform") },"exchanges" to all.size,"contentExchanges" to content.size,"schemaExitCode" to code))
            val ledger=content.groupBy { it["operationId"].toString() }.map { (op,rows) -> mapOf("operationId" to op,"implementation" to "WRITTEN","ownerIntegrationSuccessObserved" to rows.any { (it["status"] as Int) in 200..299 && it["statusMatches"]==true },"ownerIntegrationErrorObserved" to rows.any { (it["status"] as Int)>=400 && it["statusMatches"]==true },"statuses" to rows.map { it["status"] }.distinct(),"external" to "NOT_APPLICABLE","independentQa" to "PENDING_Q13") }.sortedBy { it["operationId"].toString() }
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("operation-results.json").toFile(),ledger)
            val roots=listOf(Path.of("src/main/kotlin/qanda/backend/content"),Path.of("src/main/resources/db/migration"),Path.of("src/test/kotlin/qanda/backend/content"))
            val fingerprints=linkedMapOf<String,String>()
            for(root in roots)Files.walk(root).use { paths -> paths.filter { Files.isRegularFile(it) && it.toString().substringAfterLast('.') in setOf("kt","sql","py","gradle") }.sorted().forEach { fingerprints[it.toString()]=sha(Files.readAllBytes(it)) } }
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("source-sha256.json").toFile(),fingerprints)
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("migration-history.json").toFile(),jdbc.queryForList("SELECT version,description,script,success FROM flyway_schema_history ORDER BY installed_rank"))
            assertEquals(0,code,"Complete runtime schema verification failed; inspect retained errors")
            assertEquals(23,ledger.size)
            assertTrue(ledger.all { it["ownerIntegrationSuccessObserved"]==true && it["ownerIntegrationErrorObserved"]==true },"Every operation must have real positive and negative HTTP evidence")
        } finally {
            capture.stop();database.stop()
            Files.walk(assetRoot).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }
}
