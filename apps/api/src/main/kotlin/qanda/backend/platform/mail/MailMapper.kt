package qanda.backend.platform.mail

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.time.Instant
import java.util.UUID

enum class SendState { ACCEPTED, RETRYABLE_FAILED, PERMANENT_FAILED, UNKNOWN, CANCELLED }
data class SendResult(val state: SendState,val providerMessageId: String?=null,val errorCode: String?=null)
@Mapper interface MailQueries {
    fun sweep()
    fun claim(): MailDelivery?
    fun lease(@Param("id") id: UUID,@Param("leaseId") leaseId: UUID)
    fun record(@Param("id") id: UUID,@Param("leaseId") leaseId: UUID,@Param("state") state: String,@Param("messageId") messageId: String?,@Param("error") error: String?)
}
