package qanda.backend.platform.files

import jakarta.servlet.http.HttpServletRequest
import org.springframework.core.env.Environment
import org.springframework.http.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.web.bind.annotation.*
import qanda.backend.content.ContentAccess
import qanda.backend.content.ContentQueries
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import qanda.backend.platform.security.*
import java.nio.file.*
import java.security.MessageDigest
import java.util.HexFormat
import java.util.UUID

data class FileView(val id: UUID,val mediaType: String,val sizeBytes: Long,val sha256: String,val widthPixels: Int,val heightPixels: Int)

@Service
class FileService(private val files: FileAssetMapper,private val access: ContentAccess,private val content: ContentQueries,private val sql: FileQueries,private val environment: Environment) {
    private fun root(): Path {
        if(!environment.getProperty("qanda.backend.files.enabled",Boolean::class.java,false)) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"FILES_UNAVAILABLE","文件服务尚未启用")
        val root=Path.of(environment.getRequiredProperty("qanda.backend.files.root")).toAbsolutePath().normalize()
        Files.createDirectories(root)
        if(Files.isSymbolicLink(root)) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"FILES_UNAVAILABLE","文件目录不符合要求")
        return root
    }
    @Transactional
    fun upload(actor: Actor,bankId: UUID,mediaType: String,bytes: ByteArray): FileView {
        access.bank(actor,bankId,true)
        if(mediaType !in setOf("image/png","image/jpeg","image/webp")) throw ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"IMAGE_TYPE_UNSUPPORTED","仅支持PNG、JPEG和WebP")
        val limits=ImageLimits(mediaType);val image=ImageNormalizer.normalize(ImageNormalizer.readBounded(bytes.inputStream(),limits.maxBytes),limits)
        val row=FileAsset().apply { id=UUID.randomUUID();this.bankId=bankId;uploadedBy=actor.id;storageKey="$id.png";sha256=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(image.bytes));sizeBytes=image.bytes.size.toLong();widthPixels=image.width;heightPixels=image.height }
        val path=root().resolve(row.storageKey)
        Files.write(path,image.bytes,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)
        Files.setPosixFilePermissions(path,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
        // shortcut: a crash before metadata commit can leave an orphan; add reconciliation before multiple upload workers.
        TransactionSynchronizationManager.registerSynchronization(object: TransactionSynchronization { override fun afterCompletion(status: Int) { if(status!=TransactionSynchronization.STATUS_COMMITTED) Files.deleteIfExists(path) } })
        files.insert(row)
        return FileView(row.id!!,row.mediaType,row.sizeBytes,row.sha256,row.widthPixels,row.heightPixels)
    }
    fun read(actor: Actor,id: UUID): ByteArray {
        val row=files.selectById(id) ?: missing()
        if(actor.kind=="ADMIN") access.bank(actor,row.bankId!!) else if(content.bank(row.bankId!!)==null && !sql.issuedTo(actor.id,id)) missing()
        if(!row.storageKey.matches(Regex("[0-9a-f-]{36}\\.png"))) missing()
        val path=root().resolve(row.storageKey)
        val bytes=try { Files.newInputStream(path,LinkOption.NOFOLLOW_LINKS).use { ImageNormalizer.readBounded(it,5L*1024*1024) } } catch(_: java.io.IOException) { throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"FILE_UNAVAILABLE","图片暂不可读取") }
        val hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
        if(bytes.size.toLong()!=row.sizeBytes || hash!=row.sha256) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"FILE_INTEGRITY_FAILURE","图片校验失败")
        return bytes
    }
}

@RestController
@RequestMapping("/api/v1",produces=["application/json"])
class FileController(private val service: FileService,private val sessions: Sessions,private val commands: Commands) {
    @PostMapping("/admin/question-banks/{id}/images",consumes=["image/png","image/jpeg","image/webp"])
    @io.swagger.v3.oas.annotations.Operation(requestBody=io.swagger.v3.oas.annotations.parameters.RequestBody(required=true,content=[io.swagger.v3.oas.annotations.media.Content(mediaType="image/png",schema=io.swagger.v3.oas.annotations.media.Schema(type="string",format="binary")),io.swagger.v3.oas.annotations.media.Content(mediaType="image/jpeg",schema=io.swagger.v3.oas.annotations.media.Schema(type="string",format="binary")),io.swagger.v3.oas.annotations.media.Content(mediaType="image/webp",schema=io.swagger.v3.oas.annotations.media.Schema(type="string",format="binary"))]))
    fun upload(@PathVariable id: UUID,@RequestHeader("Content-Type") mediaType: String,@RequestHeader("Idempotency-Key") key: UUID,r: HttpServletRequest): FileView {
        val bytes=ImageNormalizer.readBounded(r.inputStream,5L*1024*1024)
        val normalized=mediaType.substringBefore(';').lowercase(java.util.Locale.ROOT)
        val a=sessions.admin();return commands.run(a,key,"UPLOAD_IMAGE:$id:$normalized",bytes,FileView::class.java,r.requestId()) { service.upload(a,id,normalized,bytes) }
    }
    @GetMapping("/files/{id}",produces=["image/png"]) fun read(@PathVariable id: UUID): ResponseEntity<ByteArray> = ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(service.read(sessions.current(),id))
}
