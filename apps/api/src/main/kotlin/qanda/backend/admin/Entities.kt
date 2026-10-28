package qanda.backend.admin

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("admin_account")
class AdminAccount {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var username: String = ""
    var name: String = ""
    var passwordHash: String = ""
    var role: String = "CONTENT_ADMIN"
    var status: String = "ACTIVE"
    var version: Long = 1
    var credentialVersion: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
    var lastLoginAt: Instant? = null
}

@TableName("admin_session")
class AdminSession {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var adminId: UUID? = null
    var tokenDigest: ByteArray = byteArrayOf()
    var credentialVersion: Long = 1
    var deviceId: UUID? = null
    var issuedAt: Instant = Instant.now()
    var expiresAt: Instant = Instant.now()
    var lastSeenAt: Instant = Instant.now()
    var revokedAt: Instant? = null
}

@TableName("security_policy")
class SecurityPolicy {
    @TableId(type = IdType.INPUT)
    var id: Int = 1
    var lockEnabled: Boolean = true
    var maxAttempts: Int = 5
    var lockMinutes: Int = 30
    var sessionMinutes: Int = 30
    var minPasswordLength: Int = 12
    var requireLetter: Boolean = true
    var requireNumber: Boolean = true
    var requireMixedCase: Boolean = false
    var version: Long = 1
    var updatedAt: Instant = Instant.now()
}
