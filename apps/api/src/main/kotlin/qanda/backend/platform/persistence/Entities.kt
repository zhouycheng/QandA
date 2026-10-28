package qanda.backend.platform.persistence

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("command_receipt")
class CommandReceipt {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var scope: String = ""
    var operation: String = ""
    var commandId: UUID? = null
    var actorUserId: UUID? = null
    var actorAdminId: UUID? = null
    var payloadDigest: ByteArray = byteArrayOf()
    var digestKeyVersion: Int = 1
    var responseJson: String = ""
    var createdAt: Instant = Instant.now()
}

@TableName("audit_log")
class AuditLog {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var actorUserId: UUID? = null
    var actorAdminId: UUID? = null
    var operation: String = ""
    var requestId: UUID? = null
    var outcome: String = "SUCCESS"
    var reasonCode: String? = null
    var createdAt: Instant = Instant.now()
}
