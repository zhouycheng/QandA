package qanda.backend.platform.files

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.Assertions.*
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.core.env.MapPropertySource
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.testcontainers.containers.PostgreSQLContainer
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.nio.ByteBuffer
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.CRC32
import javax.imageio.ImageIO

@Tag("platform-acceptance")
@Tag("platform-file")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlatformFileAcceptanceTest {
    private lateinit var database: PostgreSQLContainer<Nothing>
    private lateinit var jdbc: JdbcTemplate
    private lateinit var tx: JdbcTransactions
    private lateinit var root: Path
    private lateinit var assets: JdbcBinaryAssets
    private val account = UUID.randomUUID()
    private val subject = UUID.randomUUID()
    private val otherSubject = UUID.randomUUID()
    private val actor = AssetActor(account)
    private val evidence = linkedMapOf<String, Any>()
    private val clock = Clock.systemUTC()
    private val webp = Base64.getDecoder().decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQrVJUsP+BiOh/AAA=")

    // This test-only policy checks capability freshness; business access stays with Q05/Q04.
    private data class TestAccess(override val fileId: UUID, override val subjectId: UUID, val transaction: Long) : AssetAccessContext
    private val policy = object : AssetReadPolicy {
        override fun supports(context: AssetAccessContext) = context is TestAccess
        override fun validateReadInTransaction(context: AssetAccessContext, now: Instant) {
            check(context is TestAccess && context.transaction == transactionId())
        }
    }
    private fun transactionId() = jdbc.queryForObject("SELECT txid_current()", Long::class.java)!!
    private fun limits(type: String = "image/png", scope: UUID = subject) = ImageLimits(scope, type)
    private fun png(width: Int = 3, height: Int = 2): ByteArray {
        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
        image.setRGB(0, 0, 0x145a82)
        return ByteArrayOutputStream().also { assertTrue(ImageIO.write(image, "png", it)); image.flush() }.toByteArray()
    }
    private fun upload(bytes: ByteArray = png(), operation: UUID = UUID.randomUUID(), imageLimits: ImageLimits = limits()) = assets.stage(operation, actor, imageLimits, ByteArrayInputStream(bytes))
    private fun prepared(file: FileReady, provider: JdbcBinaryAssets = assets) = tx.required { provider.prepareReadInTransaction(TestAccess(file.fileId, subject, transactionId())) }
    private fun error(code: String, block: () -> Unit): ApiException = assertThrows(ApiException::class.java, block).also { assertEquals(code, it.code) }
    private fun key(file: FileReady) = jdbc.queryForObject("SELECT storage_key FROM file_asset WHERE id=?", String::class.java, file.fileId)!!
    private fun objectPath(file: FileReady) = root.resolve("objects").resolve(key(file))

    @BeforeAll fun start() {
        database = PostgreSQLContainer<Nothing>("postgres:17.6-alpine").apply { withDatabaseName("qanda_backend"); withUsername("platform_files"); withPassword("isolated-platform-files"); start() }
        val dataSource = DriverManagerDataSource(database.jdbcUrl, database.username, database.password)
        jdbc = JdbcTemplate(dataSource); tx = JdbcTransactions(DataSourceTransactionManager(dataSource))
        val result = Flyway.configure().dataSource(dataSource).locations("classpath:db/migration/platform", "classpath:db/migration/identity", "classpath:db/migration/authorization", "classpath:db/migration/adminsecurity", "classpath:db/migration/content").cleanDisabled(true).outOfOrder(false).load().migrate()
        evidence["actualMigrationsApplied"] = result.migrationsExecuted
        jdbc.update("INSERT INTO identity_account(id,account_code,nickname,status,created_at,updated_at) VALUES (?,'QA0000000001','文件验收','ACTIVE',clock_timestamp(),clock_timestamp())", account)
        for (id in listOf(subject, otherSubject)) jdbc.update("INSERT INTO content_subject(id,source,owner_account_id,title,created_by,created_at,updated_at) VALUES (?,'USER',?,'文件验收科目',?,clock_timestamp(),clock_timestamp())", id, account, account)
        root = Files.createTempDirectory("qanda-private-assets-")
        assets = JdbcBinaryAssets(jdbc, tx, clock, root) { listOf(policy) }
    }

    @Test fun `PNG persists across provider restart with stable operation metadata and private bytes`() {
        val operation = UUID.randomUUID()
        val raw = png()
        val ready = upload(raw, operation)
        val restarted = JdbcBinaryAssets(jdbc, tx, clock, root) { listOf(policy) }
        assertEquals(ready, restarted.stage(operation, actor, limits(), ByteArrayInputStream(raw)))
        assertEquals(ready.fileId, assets.readStage(operation, actor, limits())!!.ready!!.fileId)
        assertEquals("image/png", ready.mediaType)
        assertEquals(3, ready.widthPixels); assertEquals(2, ready.heightPixels)
        assets.open(prepared(ready)).use { opened ->
            val bytes = opened.stream.readAllBytes()
            assertEquals(ready.sizeBytes, bytes.size.toLong())
            assertEquals(ready.sha256, HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)))
        }
        assertEquals(PosixFilePermissions.fromString("rwx------"), Files.getPosixFilePermissions(root))
        assertEquals(PosixFilePermissions.fromString("rw-------"), Files.getPosixFilePermissions(objectPath(ready)))
        evidence["persistentIdempotencyPrivateModes"] = true
    }

    @Test fun `runtime configuration exposes only the explicitly enabled real binary provider`() {
        for (enabled in listOf(false, true)) AnnotationConfigApplicationContext().use { context ->
            context.environment.propertySources.addFirst(MapPropertySource("file-fixture", mapOf("qanda.backend.files.enabled" to enabled.toString(), "qanda.backend.files.root" to root.toString())))
            context.beanFactory.registerSingleton("fixtureJdbc", jdbc)
            context.beanFactory.registerSingleton("fixtureTransactions", tx)
            context.beanFactory.registerSingleton("fixtureClock", clock)
            context.register(FileRuntimeConfiguration::class.java); context.refresh()
            if (!enabled) assertTrue(context.getBeansOfType(BinaryAssetPort::class.java).isEmpty())
            else {
                val provider = context.getBean(BinaryAssetPort::class.java)
                assertTrue(provider is JdbcBinaryAssets)
                val ready = provider.stage(UUID.randomUUID(), actor, limits(), ByteArrayInputStream(png()))
                error("FILE_ACCESS_POLICY_UNAVAILABLE") { tx.required { provider.prepareReadInTransaction(TestAccess(ready.fileId, subject, transactionId())) } }
            }
        }
        evidence["realRuntimeBeanAndFailClosedPolicy"] = true
    }

    @Test fun `JPEG and WebP really decode and publish metadata-free canonical PNG`() {
        val image = BufferedImage(2, 3, BufferedImage.TYPE_INT_RGB)
        val jpeg = ByteArrayOutputStream().also { assertTrue(ImageIO.write(image, "jpeg", it)); image.flush() }.toByteArray()
        for ((raw, type) in listOf(jpeg to "image/jpeg", webp to "image/webp")) {
            val ready = upload(raw, imageLimits = limits(type))
            assertEquals("image/png", ready.mediaType)
            assertEquals(2, ready.widthPixels); assertEquals(3, ready.heightPixels)
            assets.open(prepared(ready)).use { result ->
                val bytes = result.stream.readAllBytes()
                assertEquals("PNG", String(bytes, 1, 3, Charsets.US_ASCII))
                assertNotNull(ImageIO.read(ByteArrayInputStream(bytes)))
                assertFalse(String(bytes, Charsets.ISO_8859_1).contains("Exif"))
            }
        }
        evidence["actualDecode"] = listOf("PNG", "JPEG", "WebP")
    }

    @Test fun `source ancillary metadata is removed from the persisted PNG`() {
        val raw = png()
        val text = "Comment\u0000private metadata fixture".toByteArray(Charsets.ISO_8859_1)
        val chunk = ByteArrayOutputStream().also { buffer ->
            DataOutputStream(buffer).use { output ->
                output.writeInt(text.size)
                val content = "tEXt".toByteArray() + text
                output.write(content); output.writeInt(CRC32().also { it.update(content) }.value.toInt())
            }
        }.toByteArray()
        val annotated = raw.copyOfRange(0, raw.size - 12) + chunk + raw.copyOfRange(raw.size - 12, raw.size)
        assertTrue(String(annotated, Charsets.ISO_8859_1).contains("private metadata fixture"))
        val ready = upload(annotated)
        assets.open(prepared(ready)).use { assertFalse(String(it.stream.readAllBytes(), Charsets.ISO_8859_1).contains("private metadata fixture")) }
        evidence["sourceMetadataStripped"] = true
    }

    @Test fun `type malformed bytes dimensions and both byte limits reject before READY`() {
        error("IMAGE_TYPE_MISMATCH") { upload(png(), imageLimits = limits("image/jpeg")) }
        error("IMAGE_TYPE_UNSUPPORTED") { upload("<svg></svg>".toByteArray()) }
        error("IMAGE_INVALID") { upload(png().copyOf(30)) }
        error("IMAGE_DIMENSIONS_EXCEEDED") { upload(png(8193, 1)) }
        val hugePixels = png().also { bytes ->
            ByteBuffer.wrap(bytes).putInt(16, 8192).putInt(20, 8192)
            ByteBuffer.wrap(bytes).putInt(29, CRC32().also { it.update(bytes, 12, 17) }.value.toInt())
        }
        error("IMAGE_DIMENSIONS_EXCEEDED") { upload(hugePixels) }
        error("IMAGE_DIMENSIONS_EXCEEDED") { upload(png(), imageLimits = ImageLimits(subject, "image/png", maxPixels = 5)) }
        error("IMAGE_TOO_LARGE") { upload(ByteArray(5 * 1024 * 1024 + 1)) }
        error("IMAGE_TOO_LARGE") { upload(webp, imageLimits = ImageLimits(subject, "image/webp", maxBytes = webp.size.toLong())) }
        evidence["inputAndOutputBounds"] = true
    }

    @Test fun `misconfigured existing directory permissions are rejected without changing them`() {
        val public = Files.createTempDirectory("qanda-permissions-probe-")
        try {
            val permissions = PosixFilePermissions.fromString("rwxr-xr-x")
            Files.setPosixFilePermissions(public, permissions)
            assertThrows(IllegalArgumentException::class.java) { JdbcBinaryAssets(jdbc, tx, clock, public) { listOf(policy) } }
            assertEquals(permissions, Files.getPosixFilePermissions(public))
            assertThrows(IllegalArgumentException::class.java) { JdbcBinaryAssets(jdbc, tx, clock, Path.of("/")) { emptyList() } }
        } finally { Files.deleteIfExists(public) }
        evidence["existingDirectoryPermissionsPreserved"] = true
    }

    @Test fun `FAILED mapping is retained and every stable input dimension conflicts on reuse`() {
        val operation = UUID.randomUUID()
        val raw = "bad image".toByteArray()
        error("IMAGE_TYPE_UNSUPPORTED") { upload(raw, operation) }
        val stage = assets.readStage(operation, actor, limits())!!
        assertEquals(AssetStageState.FAILED, stage.state)
        error("IMAGE_TYPE_UNSUPPORTED") { upload(raw, operation) }
        assertEquals(stage.fileId, assets.readStage(operation, actor, limits())!!.fileId)
        error("IDEMPOTENCY_CONFLICT") { upload(png(), operation) }
        error("IDEMPOTENCY_CONFLICT") { assets.readStage(operation, AssetActor(UUID.randomUUID()), limits()) }
        error("IDEMPOTENCY_CONFLICT") { assets.readStage(operation, actor, limits(scope = otherSubject)) }
        error("IDEMPOTENCY_CONFLICT") { assets.readStage(operation, actor, ImageLimits(subject, "image/png", maxDimension = 100)) }
        evidence["failedMappingInputConflict"] = true
    }

    @Test fun `database failure after byte publication recovers same object without replacement`() {
        val operation = UUID.randomUUID()
        val raw = png()
        failReadyWrites()
        try { error("FILE_STORAGE_UNAVAILABLE") { upload(raw, operation) } } finally { resumeReadyWrites() }
        val interrupted = assets.readStage(operation, actor, limits())!!
        assertEquals(AssetStageState.STAGING, interrupted.state)
        val storage = jdbc.queryForObject("SELECT storage_key FROM file_asset WHERE id=?", String::class.java, interrupted.fileId)!!
        val path = root.resolve("objects").resolve(storage)
        assertTrue(Files.isRegularFile(path))
        val fileKey = Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes::class.java).fileKey()
        val ready = upload(raw, operation)
        assertEquals(interrupted.fileId, ready.fileId)
        assertEquals(fileKey, Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes::class.java).fileKey())
        evidence["publishedBeforeCommitRecovery"] = true
    }

    @Test fun `existing corrupt object is never overwritten and expired STAGING retains mapping`() {
        val operation = UUID.randomUUID()
        val raw = png()
        failReadyWrites()
        try { error("FILE_STORAGE_UNAVAILABLE") { upload(raw, operation) } } finally { resumeReadyWrites() }
        val stage = assets.readStage(operation, actor, limits())!!
        val storage = jdbc.queryForObject("SELECT storage_key FROM file_asset WHERE id=?", String::class.java, stage.fileId)!!
        val objectPath = root.resolve("objects").resolve(storage)
        Files.writeString(objectPath, "corrupt fixture")
        error("CONTENT_INTEGRITY_FAILURE") { upload(raw, operation) }
        assertEquals("corrupt fixture", Files.readString(objectPath))
        val expired = JdbcBinaryAssets(jdbc, tx, Clock.offset(clock, Duration.ofSeconds(86410)), root) { listOf(policy) }
        error("UPLOAD_EXPIRED") { expired.stage(operation, actor, limits(), ByteArrayInputStream(raw)) }
        assertEquals(stage.fileId, assets.readStage(operation, actor, limits())!!.fileId)
        assertEquals(AssetStageState.FAILED, assets.readStage(operation, actor, limits())!!.state)
        evidence["publishIfAbsentAndExpiry"] = true
    }

    @Test fun `concurrent duplicate stages converge on one permanent file identity`() {
        val operation = UUID.randomUUID()
        val raw = png()
        val pool = Executors.newFixedThreadPool(2)
        val results = try { pool.invokeAll((1..2).map { Callable { runCatching { upload(raw, operation) } } }).map { it.get() } } finally { pool.shutdownNow() }
        val ready = upload(raw, operation)
        for (result in results) result.fold({ assertEquals(ready.fileId, it.fileId) }, { assertEquals("FILE_STAGE_BUSY", (it as ApiException).code) })
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM file_asset WHERE upload_operation_id=?", Long::class.java, operation))
        evidence["concurrentStableMapping"] = true
    }

    @Test fun `file guards capabilities and byte IO enforce transaction freshness`() {
        val ready = upload()
        assertThrows(IllegalStateException::class.java) { tx.required { upload() } }
        assertThrows(org.springframework.transaction.IllegalTransactionStateException::class.java) { assets.lockReadyInTransaction(subject, listOf(ready.fileId)) }
        val guard = tx.required { assets.lockReadyInTransaction(subject, listOf(ready.fileId)).single().also { assertEquals(ready, assets.assertGuardInTransaction(it, subject)) } }
        assertThrows(IllegalStateException::class.java) { tx.required { assets.assertGuardInTransaction(guard, subject) } }
        val capability = prepared(ready)
        assertThrows(IllegalStateException::class.java) { tx.required { assets.open(capability) } }
        assets.open(capability).close()
        error("FILE_ACCESS_CONTEXT_EXPIRED") { assets.open(capability) }
        val stale = tx.required { TestAccess(ready.fileId, subject, transactionId()) }
        assertThrows(IllegalStateException::class.java) { tx.required { assets.prepareReadInTransaction(stale) } }
        val noPolicy = JdbcBinaryAssets(jdbc, tx, clock, root) { emptyList() }
        error("FILE_ACCESS_POLICY_UNAVAILABLE") { tx.required { noPolicy.prepareReadInTransaction(object : AssetAccessContext { override val fileId = ready.fileId; override val subjectId = subject }) } }
        val cap = prepared(ready)
        val otherIssuer = JdbcBinaryAssets(jdbc, tx, clock, root) { listOf(policy) }
        error("FILE_ACCESS_CONTEXT_EXPIRED") { otherIssuer.open(cap) }
        val now = AtomicReference(clock.instant())
        val movingClock = object : Clock() {
            override fun instant() = now.get()
            override fun getZone() = java.time.ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId): Clock = this
        }
        val timed = JdbcBinaryAssets(jdbc, tx, movingClock, root) { listOf(policy) }
        val expired = prepared(ready, timed)
        now.set(now.get().plusSeconds(6))
        error("FILE_ACCESS_CONTEXT_EXPIRED") { timed.open(expired) }
        evidence["freshReadAndTransactionGuards"] = mapOf("testOnlyOwnerPolicy" to true, "businessReadIntegration" to "PENDING_Q05")
    }

    @Test fun `missing corrupt and symbolic-link bytes return controlled integrity failures`() {
        val missing = upload(); Files.delete(objectPath(missing))
        error("CONTENT_INTEGRITY_FAILURE") { assets.open(prepared(missing)) }
        val corrupt = upload(); Files.write(objectPath(corrupt), ByteArray(corrupt.sizeBytes.toInt()) { 1 })
        error("CONTENT_INTEGRITY_FAILURE") { assets.open(prepared(corrupt)) }
        val linked = upload(); val path = objectPath(linked); Files.delete(path); Files.createSymbolicLink(path, objectPath(corrupt))
        error("CONTENT_INTEGRITY_FAILURE") { assets.open(prepared(linked)) }
        evidence["integrityFailures"] = listOf("missing", "sameSizeCorrupt", "symlink")
    }

    @Test fun `actual subject and account foreign keys validate and protect immutable READY metadata`() {
        assertEquals(2L, jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname IN ('file_asset_account_fk','file_asset_subject_fk') AND convalidated", Long::class.java))
        val ready = upload()
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE file_asset SET subject_id=? WHERE id=?", otherSubject, ready.fileId) }
        assertThrows(DataAccessException::class.java) { jdbc.update("UPDATE file_asset SET sha256=? WHERE id=?", "0".repeat(64), ready.fileId) }
        assertThrows(DataAccessException::class.java) { jdbc.update("DELETE FROM file_asset WHERE id=?", ready.fileId) }
        assertThrows(DataAccessException::class.java) { assets.stage(UUID.randomUUID(), AssetActor(UUID.randomUUID()), limits(), ByteArrayInputStream(png())) }
        assertThrows(DataAccessException::class.java) { upload(imageLimits = limits(scope = UUID.randomUUID())) }
        evidence["realFkAndRetention"] = true
    }

    private fun failReadyWrites() {
        jdbc.execute("CREATE FUNCTION platform_fail_ready() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.state=''READY'' THEN RAISE EXCEPTION ''controlled ready failure''; END IF; RETURN NEW; END'")
        jdbc.execute("CREATE TRIGGER platform_fail_ready BEFORE UPDATE ON file_asset FOR EACH ROW EXECUTE FUNCTION platform_fail_ready()")
    }
    private fun resumeReadyWrites() { jdbc.execute("DROP TRIGGER platform_fail_ready ON file_asset"); jdbc.execute("DROP FUNCTION platform_fail_ready()") }

    @AfterAll fun finish() {
        try {
            evidence["contentImageCompositeFk"] = jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname='content_image_file_asset_fk' AND convalidated", Long::class.java)!!
            val path = Path.of(".backend-runtime/platform-acceptance/file-evidence.json")
            Files.createDirectories(path.parent); jacksonObjectMapper().writerWithDefaultPrettyPrinter().writeValue(path.toFile(), evidence)
        } finally {
            if (::database.isInitialized) database.stop()
            if (::root.isInitialized) Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists) }
        }
    }
}
