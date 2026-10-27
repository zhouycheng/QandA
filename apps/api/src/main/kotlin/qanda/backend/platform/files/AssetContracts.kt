package qanda.backend.platform.files

import java.io.Closeable
import java.io.InputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

data class FileReady(val fileId: UUID, val mediaType: String, val sizeBytes: Long, val sha256: String, val widthPixels: Int, val heightPixels: Int, val readyAt: Instant)
data class AssetActor(val accountId: UUID)
data class ImageLimits(
    val subjectId: UUID,
    val declaredMediaType: String,
    val profileVersion: Int = 1,
    val maxBytes: Long = 5L * 1024 * 1024,
    val maxDimension: Int = 8192,
    val maxPixels: Long = 32_000_000,
) {
    init {
        require(declaredMediaType in setOf("image/png", "image/jpeg", "image/webp"))
        require(profileVersion == 1 && maxBytes in 1..5L * 1024 * 1024 && maxDimension in 1..8192 && maxPixels in 1..32_000_000)
    }
}
enum class AssetStageState { STAGING, READY, FAILED }
data class AssetStage(val fileId: UUID, val state: AssetStageState, val ready: FileReady?, val failureCode: String?)
class FileGuard internal constructor(val ready: FileReady, internal val subjectId: UUID, internal val transactionId: Long)

/** Implemented by Q05/Q06's opaque, fresh, owner-validated read context. */
interface AssetAccessContext { val fileId: UUID; val subjectId: UUID }
interface AssetReadPolicy {
    fun supports(context: AssetAccessContext): Boolean
    fun validateReadInTransaction(context: AssetAccessContext, now: Instant)
}
class PreparedAssetRead internal constructor(val ready: FileReady, internal val storageKey: String, internal val expiresAt: Instant, internal val issuer: UUID) {
    internal val opened = AtomicBoolean(false)
}
class OpenedAsset(val ready: FileReady, val stream: InputStream) : Closeable {
    override fun close() = stream.close()
}

interface BinaryAssetPort {
    fun stage(uploadOperationId: UUID, actor: AssetActor, limits: ImageLimits, rawBytes: InputStream): FileReady
    fun readStage(uploadOperationId: UUID, actor: AssetActor, limits: ImageLimits): AssetStage?
    fun lockReadyInTransaction(subjectId: UUID, fileIds: List<UUID>): List<FileGuard>
    fun assertGuardInTransaction(guard: FileGuard, subjectId: UUID): FileReady
    fun prepareReadInTransaction(context: AssetAccessContext): PreparedAssetRead
    fun open(prepared: PreparedAssetRead): OpenedAsset
}
