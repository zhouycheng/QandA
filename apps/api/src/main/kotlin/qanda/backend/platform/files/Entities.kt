package qanda.backend.platform.files

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("file_asset")
class FileAsset {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var bankId: UUID? = null
    var uploadedBy: UUID? = null
    var storageKey: String = ""
    var sha256: String = ""
    var mediaType: String = "image/png"
    var sizeBytes: Long = 0
    var widthPixels: Int = 0
    var heightPixels: Int = 0
    var createdAt: Instant = Instant.now()
}
