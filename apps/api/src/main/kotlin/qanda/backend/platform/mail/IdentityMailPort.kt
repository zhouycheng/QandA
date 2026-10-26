package qanda.backend.platform.mail

import java.time.Instant
import java.util.UUID

class PreparedMailEnvelope internal constructor(
    val challengeId: UUID,
    val templateCode: String,
    val templateVersion: Int,
    val expiresAt: Instant,
    val ciphertext: String,
    val nonce: String,
    val keyVersion: Int,
)

interface IdentityMailPort {
    fun prepareIdentityMailEnvelope(challengeId: UUID, recipient: String, code: String, templateCode: String, templateVersion: Int, expiresAt: Instant): PreparedMailEnvelope
    fun enqueueIdentityMailInTransaction(challengeId: UUID, expiresAt: Instant, encryptedMessageRef: PreparedMailEnvelope, requestId: UUID): UUID
}
