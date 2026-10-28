package qanda.backend.admin

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import qanda.backend.identity.UserAccount
import java.time.Instant
import java.util.UUID

@Mapper interface AdminQueries {
    fun byUsername(@Param("username") username: String): AdminAccount?
    fun lockControl(): Instant?
    fun completeBootstrap()
    fun platformCount(): Long
    fun userPage(@Param("keyword") keyword: String?,@Param("collegeId") collegeId: UUID?,@Param("majorId") majorId: UUID?,@Param("status") status: String?,@Param("offset") offset: Int,@Param("limit") limit: Int): List<UserAccount>
    fun userCount(@Param("keyword") keyword: String?,@Param("collegeId") collegeId: UUID?,@Param("majorId") majorId: UUID?,@Param("status") status: String?): Long
}
