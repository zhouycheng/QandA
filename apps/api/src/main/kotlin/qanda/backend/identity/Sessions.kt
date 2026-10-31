package qanda.backend.identity

import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.admin.*
import qanda.backend.platform.http.forbidden
import qanda.backend.platform.security.Actor
import java.time.Clock
import java.util.UUID

@Service
class Sessions(private val sql: IdentityMapper, private val users: UserAccountMapper, private val admins: AdminAccountMapper,
               private val policies: SecurityPolicyMapper, private val crypto: IdentityCrypto, private val clock: Clock) {
    fun optional(): Actor? = SecurityContextHolder.getContext().authentication?.principal as? Actor
    fun current(): Actor = optional() ?: unauthenticated()
    fun student(): Actor = current().also { if(it.kind!="USER") forbidden() }
    fun studentOrGuest(): Actor? = optional()?.also { if(it.kind!="USER") forbidden() }
    fun admin(platformOnly: Boolean = false): Actor = current().also { if(it.kind!="ADMIN" || platformOnly && it.role!="PLATFORM_ADMIN") forbidden() }

    @Transactional
    fun authenticate(token: String): Actor {
        val now=clock.instant()
        return when {
            token.matches(Regex("u_[A-Za-z0-9_-]{43}")) -> {
                val session=sql.userSession(crypto.tokenDigest(token)) ?: unauthenticated()
                val user=users.selectById(session.userId) ?: unauthenticated()
                if(session.revokedAt!=null || !session.expiresAt.isAfter(now) || user.status!="ACTIVE" || session.credentialVersion!=user.credentialVersion) unauthenticated()
                sql.touchUserSession(session.id!!,now)
                Actor(user.id!!,session.id!!,"USER",session.clientType)
            }
            token.matches(Regex("a_[A-Za-z0-9_-]{43}")) -> {
                val session=sql.adminSession(crypto.tokenDigest(token)) ?: unauthenticated()
                val admin=admins.selectById(session.adminId) ?: unauthenticated()
                val policy=policies.selectById(1)
                if(session.revokedAt!=null || !session.expiresAt.isAfter(now) || !session.lastSeenAt.plusSeconds(policy.sessionMinutes*60L).isAfter(now) || admin.status!="ACTIVE" || session.credentialVersion!=admin.credentialVersion) unauthenticated()
                sql.touchAdminSession(session.id!!,now)
                Actor(admin.id!!,session.id!!,"ADMIN","ADMIN_WEB",admin.role)
            }
            else -> unauthenticated()
        }
    }
    fun checkInTransaction(actor: Actor) {
        val now=clock.instant()
        if(actor.kind=="USER") {
            val user=sql.lockUser(actor.id) ?: unauthenticated();val session=sql.lockUserSession(actor.sessionId) ?: unauthenticated()
            if(user.status!="ACTIVE" || session.userId!=actor.id || session.revokedAt!=null || !session.expiresAt.isAfter(now) || session.credentialVersion!=user.credentialVersion) unauthenticated()
        } else {
            val admin=sql.lockAdmin(actor.id) ?: unauthenticated();val session=sql.lockAdminSession(actor.sessionId) ?: unauthenticated()
            if(admin.status!="ACTIVE" || admin.role!=actor.role || session.adminId!=actor.id || session.revokedAt!=null || !session.expiresAt.isAfter(now) || session.credentialVersion!=admin.credentialVersion) unauthenticated()
        }
    }
}
