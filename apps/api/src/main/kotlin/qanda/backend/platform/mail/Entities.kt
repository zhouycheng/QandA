package qanda.backend.platform.mail

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("mail_delivery")
class MailDelivery {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var challengeId: UUID? = null
    var templateCode: String = ""
    var templateVersion: Int = 1
    var ciphertext: String = ""
    var nonce: String = ""
    var keyVersion: Int = 1
    var expiresAt: Instant = Instant.now()
    var state: String = "PENDING"
    var attempts: Int = 0
    var nextAttemptAt: Instant = Instant.now()
    var leaseId: UUID? = null
    var leasedAt: Instant? = null
    var providerMessageId: String? = null
    var errorCode: String? = null
    var createdAt: Instant = Instant.now()
}
