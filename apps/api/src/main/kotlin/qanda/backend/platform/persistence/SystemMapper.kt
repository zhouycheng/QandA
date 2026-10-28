package qanda.backend.platform.persistence

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.time.Instant
import java.util.UUID

class LoginAttempt { var failures: Int = 0; var blockedUntil: Instant? = null }
@Mapper interface SystemMapper {
    fun ready(): Boolean
    fun lock(@Param("scope") scope: String): Int
    fun receipt(@Param("scope") scope: String, @Param("operation") operation: String, @Param("commandId") commandId: UUID): CommandReceipt?
    fun attempt(@Param("digest") digest: ByteArray): LoginAttempt?
    fun saveAttempt(@Param("digest") digest: ByteArray, @Param("failures") failures: Int, @Param("until") until: Instant?)
    fun clearAttempt(@Param("digest") digest: ByteArray)
    fun activity(@Param("userId") userId: UUID, @Param("platform") platform: String)
    fun auditPage(@Param("offset") offset: Int, @Param("limit") limit: Int): List<AuditLog>
    fun auditCount(): Long
}
