package qanda.backend.identity

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("user_account")
class UserAccount {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var accountCode: String = ""
    var nickname: String = ""
    var email: String? = null
    var emailKey: String? = null
    var passwordHash: String? = null
    var status: String = "ACTIVE"
    var version: Long = 1
    var credentialVersion: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}

@TableName("user_profile")
class UserProfile {
    @TableId(type = IdType.INPUT)
    var userId: UUID? = null
    var collegeId: UUID? = null
    var majorId: UUID? = null
    var enrollmentYear: Int? = null
}

@TableName("user_wechat")
class UserWechat {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var appId: String = ""
    var openId: String = ""
    var unionId: String? = null
    var createdAt: Instant = Instant.now()
}

@TableName("user_session")
class UserSession {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var tokenDigest: ByteArray = byteArrayOf()
    var credentialVersion: Long = 1
    var clientType: String = "WEB"
    var deviceId: UUID? = null
    var issuedAt: Instant = Instant.now()
    var expiresAt: Instant = Instant.now()
    var lastSeenAt: Instant = Instant.now()
    var revokedAt: Instant? = null
}

@TableName("email_challenge")
class EmailChallenge {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var userId: UUID? = null
    var purpose: String = ""
    var email: String = ""
    var emailKey: String = ""
    var codeMac: ByteArray = byteArrayOf()
    var keyVersion: Int = 1
    var eligible: Boolean = false
    var credentialVersion: Long? = null
    var failedAttempts: Int = 0
    var createdAt: Instant = Instant.now()
    var expiresAt: Instant = Instant.now()
    var consumedAt: Instant? = null
}

@TableName("wechat_ticket")
class WechatTicket {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var tokenDigest: ByteArray = byteArrayOf()
    var appId: String = ""
    var openId: String = ""
    var unionId: String? = null
    var expiresAt: Instant = Instant.now()
    var consumedAt: Instant? = null
}
