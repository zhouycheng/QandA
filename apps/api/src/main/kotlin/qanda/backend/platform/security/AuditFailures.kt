package qanda.backend.platform.security

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.security.core.context.SecurityContextHolder
import qanda.backend.platform.http.RequestIds
import qanda.backend.platform.persistence.AuditLog
import qanda.backend.platform.persistence.AuditLogMapper
import java.util.UUID

@Service
class AuditFailures(private val rows: AuditLogMapper) {
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    fun record(request: HttpServletRequest,code: String) {
        val actor=SecurityContextHolder.getContext().authentication?.principal as? Actor
        rows.insert(AuditLog().apply { id=UUID.randomUUID();actorUserId=actor?.takeIf { it.kind=="USER" }?.id;actorAdminId=actor?.takeIf { it.kind=="ADMIN" }?.id
            operation="${request.method} ${request.requestURI}".take(200);requestId=RequestIds.get(request);outcome="FAILURE";reasonCode=code })
    }
}
