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
