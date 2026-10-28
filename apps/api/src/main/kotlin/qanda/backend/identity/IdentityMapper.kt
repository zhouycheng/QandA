package qanda.backend.identity

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import qanda.backend.admin.AdminAccount
import qanda.backend.admin.AdminSession
import java.time.Instant
import java.util.UUID

@Mapper interface IdentityMapper {
    fun userByEmail(@Param("email") email: String): UserAccount?
    fun lockUser(@Param("id") id: UUID): UserAccount?
    fun lockAdmin(@Param("id") id: UUID): AdminAccount?
    fun userSession(@Param("digest") digest: ByteArray): UserSession?
    fun adminSession(@Param("digest") digest: ByteArray): AdminSession?
    fun lockUserSession(@Param("id") id: UUID): UserSession?
    fun lockAdminSession(@Param("id") id: UUID): AdminSession?
    fun touchUserSession(@Param("id") id: UUID, @Param("now") now: Instant)
    fun touchAdminSession(@Param("id") id: UUID, @Param("now") now: Instant)
    fun revokeUserSessions(@Param("userId") userId: UUID)
    fun revokeAdminSessions(@Param("adminId") adminId: UUID)
    fun lockChallenge(@Param("id") id: UUID): EmailChallenge?
    fun recentChallenge(@Param("email") email: String): Instant?
    fun failChallenge(@Param("id") id: UUID)
    fun consumeChallenge(@Param("id") id: UUID)
    fun wechat(@Param("appId") appId: String, @Param("openId") openId: String): UserWechat?
    fun lockTicket(@Param("digest") digest: ByteArray): WechatTicket?
    fun consumeTicket(@Param("id") id: UUID)
    fun updateProfile(@Param("userId") userId: UUID, @Param("collegeId") collegeId: UUID?, @Param("majorId") majorId: UUID?, @Param("year") year: Int?)
    fun updateCredentials(@Param("id") id: UUID,@Param("email") email: String?,@Param("emailKey") emailKey: String?,@Param("password") password: String?)
}
