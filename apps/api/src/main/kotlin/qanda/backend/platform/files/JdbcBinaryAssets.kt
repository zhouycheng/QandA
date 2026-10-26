package qanda.backend.platform.files

import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.transaction.JdbcTransactions
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.StandardOpenOption.*
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.HexFormat
import java.util.concurrent.Semaphore

class JdbcBinaryAssets(private val jdbc: JdbcTemplate, private val tx: JdbcTransactions, private val clock: Clock, root: Path, private val policies: () -> List<AssetReadPolicy>) : BinaryAssetPort {
    private val root = root.toAbsolutePath().normalize()
    private val objects = this.root.resolve("objects")
    private val staging = this.root.resolve("staging")
    private val workers = Semaphore(2)
    private val issuer = UUID.randomUUID()
    init {
        require(this.root.parent != null) { "Asset storage requires a dedicated private directory" }
        val permissions = PosixFilePermissions.fromString("rwx------")
        for (directory in listOf(this.root, objects, staging)) {
            require(!Files.isSymbolicLink(directory)) { "Asset directories cannot be symbolic links" }
            Files.createDirectories(directory, PosixFilePermissions.asFileAttribute(permissions))
            require(Files.getPosixFilePermissions(directory) == permissions) { "Asset directories require private owner-only permissions" }
        }
    }

    override fun stage(uploadOperationId: UUID, actor: AssetActor, limits: ImageLimits, rawBytes: InputStream): FileReady {
        outsideTransaction()
        if (!workers.tryAcquire()) unavailable("FILE_WORKERS_BUSY")
        try {
            val raw = ImageNormalizer.readBounded(rawBytes, limits.maxBytes)
            val claim = claim(uploadOperationId, actor, limits, sha(raw), raw.size.toLong())
            claim.ready?.let { ready -> verifiedChannel(claim.storageKey, ready.sizeBytes, ready.sha256).close(); return ready }
            claim.failure?.let { fail(it) }
            val token = claim.token ?: unavailable("FILE_STAGE_BUSY")
            try {
                val image = ImageNormalizer.normalize(raw, limits)
                val outputSha = sha(image.bytes)
                publish(claim.storageKey, token, image.bytes, outputSha)
                val now = at()
                val ready = FileReady(claim.id, "image/png", image.bytes.size.toLong(), outputSha, image.width, image.height, now)
                val changed = tx.required {
                    jdbc.update("""UPDATE file_asset SET state='READY',media_type=?,size_bytes=?,sha256=?,width_pixels=?,height_pixels=?,ready_at=?,
                        stage_token=NULL,stage_lease_until=NULL,failure_code=NULL,version=version+1 WHERE id=? AND state='STAGING' AND stage_token=? AND stage_lease_until>?""",
                        ready.mediaType, ready.sizeBytes, ready.sha256, ready.widthPixels, ready.heightPixels, now.sql(), claim.id, token, now.sql())
                }
                if (changed != 1) unavailable("FILE_STAGE_FENCED")
                return ready
            } catch (error: ApiException) {
                if (error.status in setOf(HttpStatus.PAYLOAD_TOO_LARGE, HttpStatus.UNSUPPORTED_MEDIA_TYPE, HttpStatus.UNPROCESSABLE_ENTITY)) {
                    tx.required { jdbc.update("UPDATE file_asset SET state='FAILED',failure_code=?,stage_token=NULL,stage_lease_until=NULL,version=version+1 WHERE id=? AND state='STAGING' AND stage_token=?", error.code, claim.id, token) }
                } else release(claim.id, token)
                throw error
            } catch (_: Exception) { release(claim.id, token); unavailable("FILE_STORAGE_UNAVAILABLE") }
        } finally { workers.release() }
    }

    override fun readStage(uploadOperationId: UUID, actor: AssetActor, limits: ImageLimits): AssetStage? {
        val row = jdbc.queryForList("SELECT * FROM file_asset WHERE upload_operation_id=?", uploadOperationId).singleOrNull() ?: return null
        checkMapping(row, actor, limits)
        val state = AssetStageState.entries.find { it.name == row["state"] } ?: unavailable("FILE_STORAGE_UNAVAILABLE")
        return AssetStage(row["id"] as UUID, state, if (state == AssetStageState.READY) ready(row) else null, row["failure_code"] as String?)
    }

    override fun lockReadyInTransaction(subjectId: UUID, fileIds: List<UUID>): List<FileGuard> = tx.mandatory {
        val transaction = transactionId()
        fileIds.distinct().sortedBy(UUID::toString).map { id ->
            val row = row(id, subjectId, "FOR UPDATE")
            FileGuard(ready(row), subjectId, transaction)
        }
    }

    override fun assertGuardInTransaction(guard: FileGuard, subjectId: UUID): FileReady = tx.mandatory {
        check(guard.transactionId == transactionId() && guard.subjectId == subjectId) { "File guard requires its original transaction and subject" }
        guard.ready
    }

    override fun prepareReadInTransaction(context: AssetAccessContext): PreparedAssetRead = tx.mandatory {
        val policy = policies().filter { it.supports(context) }.singleOrNull()
            ?: throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "FILE_ACCESS_POLICY_UNAVAILABLE", "图片访问校验暂不可用")
        val now = at()
        policy.validateReadInTransaction(context, now)
        val row = row(context.fileId, context.subjectId, "FOR SHARE")
        PreparedAssetRead(ready(row), row["storage_key"] as String, now.plusSeconds(5), issuer)
    }

    override fun open(prepared: PreparedAssetRead): OpenedAsset {
        outsideTransaction()
        if (prepared.issuer != issuer || !prepared.expiresAt.isAfter(at()) || !prepared.opened.compareAndSet(false, true)) {
            throw ApiException(HttpStatus.FORBIDDEN, "FILE_ACCESS_CONTEXT_EXPIRED", "请重新验证图片访问权限")
        }
        return OpenedAsset(prepared.ready, Channels.newInputStream(verifiedChannel(prepared.storageKey, prepared.ready.sizeBytes, prepared.ready.sha256)))
    }

    private data class Claim(val id: UUID, val storageKey: String, val token: UUID? = null, val ready: FileReady? = null, val failure: String? = null)
    private fun claim(operation: UUID, actor: AssetActor, limits: ImageLimits, rawSha: String, rawSize: Long): Claim = tx.required {
        val now = at()
        val id = UUID.randomUUID()
        val token = UUID.randomUUID()
        val inserted = jdbc.update("""INSERT INTO file_asset(id,uploaded_by_account_id,upload_operation_id,purpose,subject_id,input_profile_version,input_limits_digest,raw_sha256,raw_size_bytes,
            stage_token,stage_lease_until,storage_key,state,created_at,staging_expires_at) VALUES (?,?,?,'SUBJECT_IMAGE',?,?,?,?,?,?,?,?,'STAGING',?,?) ON CONFLICT(upload_operation_id) DO NOTHING""",
            id, actor.accountId, operation, limits.subjectId, limits.profileVersion, limitsDigest(limits), rawSha, rawSize, token, now.plusSeconds(60).sql(), "$id.png", now.sql(), now.plusSeconds(86400).sql())
        val row = jdbc.queryForMap("SELECT * FROM file_asset WHERE upload_operation_id=? FOR UPDATE", operation)
        checkMapping(row, actor, limits)
        if (row["raw_sha256"] != rawSha || (row["raw_size_bytes"] as Number).toLong() != rawSize) conflict()
        val mappedId = row["id"] as UUID
        val storageKey = row["storage_key"] as String
        when (row["state"]) {
            "READY" -> Claim(mappedId, storageKey, ready = ready(row))
            "FAILED" -> Claim(mappedId, storageKey, failure = row["failure_code"] as String)
            "STAGING" -> {
                if (!(row["staging_expires_at"] as Timestamp).toInstant().isAfter(now)) {
                    jdbc.update("UPDATE file_asset SET state='FAILED',failure_code='UPLOAD_EXPIRED',stage_token=NULL,stage_lease_until=NULL,version=version+1 WHERE id=?", mappedId)
                    Claim(mappedId, storageKey, failure = "UPLOAD_EXPIRED")
                } else if (inserted == 0 && (row["stage_lease_until"] as Timestamp).toInstant().isAfter(now)) Claim(mappedId, storageKey)
                else {
                    if (inserted == 0) jdbc.update("UPDATE file_asset SET stage_token=?,stage_lease_until=?,version=version+1 WHERE id=?", token, now.plusSeconds(60).sql(), mappedId)
                    Claim(mappedId, storageKey, token)
                }
            }
            else -> unavailable("FILE_STORAGE_UNAVAILABLE")
        }
    }

    private fun checkMapping(row: Map<String, Any?>, actor: AssetActor, limits: ImageLimits) {
        if (row["uploaded_by_account_id"] != actor.accountId || row["subject_id"] != limits.subjectId || row["input_limits_digest"] != limitsDigest(limits)) conflict()
    }
    private fun row(id: UUID, subject: UUID, lock: String): Map<String, Any?> {
        val row = jdbc.queryForList("SELECT * FROM file_asset WHERE id=? AND subject_id=? $lock", id, subject).singleOrNull()
        if (row == null || row["state"] != "READY") unavailable("FILE_NOT_READY")
        return row
    }
    private fun ready(row: Map<String, Any?>) = FileReady(row["id"] as UUID, row["media_type"] as String, (row["size_bytes"] as Number).toLong(), row["sha256"] as String,
        (row["width_pixels"] as Number).toInt(), (row["height_pixels"] as Number).toInt(), (row["ready_at"] as Timestamp).toInstant())
    private fun release(id: UUID, token: UUID) = tx.required { jdbc.update("UPDATE file_asset SET stage_lease_until=?,version=version+1 WHERE id=? AND state='STAGING' AND stage_token=?", at().sql(), id, token) }
    private fun transactionId() = jdbc.queryForObject("SELECT txid_current()", Long::class.java)!!
    private fun at() = clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private fun outsideTransaction() = check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Asset bytes require the database transaction to finish first" }
    private fun limitsDigest(limits: ImageLimits) = sha("${limits.profileVersion}/${limits.declaredMediaType}/${limits.maxBytes}/${limits.maxDimension}/${limits.maxPixels}".toByteArray())

    private fun publish(key: String, token: UUID, bytes: ByteArray, digest: String) {
        val temporary = Files.createTempFile(staging, "$token-", ".part", PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
        try {
            FileChannel.open(temporary, WRITE).use { channel ->
                val buffer = ByteBuffer.wrap(bytes)
                while (buffer.hasRemaining()) channel.write(buffer)
                channel.force(true)
            }
            try { Files.createLink(path(key), temporary) }
            catch (_: FileAlreadyExistsException) { verifiedChannel(key, bytes.size.toLong(), digest).close() }
            FileChannel.open(objects, READ).use { it.force(true) }
        } finally { Files.deleteIfExists(temporary) }
    }

    private fun path(key: String): Path {
        check(key.matches(Regex("[0-9a-f-]{36}\\.png"))) { "Invalid private storage key" }
        return objects.resolve(key)
    }
    private fun verifiedChannel(key: String, size: Long, expectedDigest: String): FileChannel {
        var channel: FileChannel? = null
        try {
            if (!Files.isRegularFile(path(key), NOFOLLOW_LINKS)) unavailable("CONTENT_INTEGRITY_FAILURE")
            channel = FileChannel.open(path(key), READ, NOFOLLOW_LINKS)
            if (channel.size() != size) unavailable("CONTENT_INTEGRITY_FAILURE")
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteBuffer.allocate(8192)
            while (channel.read(buffer) >= 0) { buffer.flip(); digest.update(buffer); buffer.clear() }
            if (digest.digest().hex() != expectedDigest) unavailable("CONTENT_INTEGRITY_FAILURE")
            channel.position(0)
            return channel
        } catch (error: Exception) {
            channel?.close()
            if (error is ApiException) throw error
            unavailable("CONTENT_INTEGRITY_FAILURE")
        }
    }
    private fun conflict(): Nothing = throw ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "该上传操作已绑定其他输入")
    private fun fail(code: String): Nothing = throw ApiException(if (code == "IMAGE_TOO_LARGE") HttpStatus.PAYLOAD_TOO_LARGE else if (code.startsWith("IMAGE_TYPE")) HttpStatus.UNSUPPORTED_MEDIA_TYPE else HttpStatus.UNPROCESSABLE_ENTITY, code, "该上传操作已失败，请更正输入后创建新操作")
    private fun unavailable(code: String): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, "图片存储暂不可用，请使用原操作重试", details = ErrorDetails(retryAfterSeconds = 1))
}
private fun Instant.sql() = Timestamp.from(this)
private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
private fun ByteArray.hex() = HexFormat.of().formatHex(this)
