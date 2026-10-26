package qanda.backend.authorization

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import qanda.backend.authorization.api.AuthorizationContentReadiness

@Component
class AuthorizationContentGate(private val jdbc: JdbcTemplate): AuthorizationContentReadiness {
    override fun requireReadyInTransaction() {
        val ready=jdbc.queryForObject("""SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='authz_subject_policy'::regclass
            AND conname='authz_subject_policy_content_fk' AND contype='f' AND convalidated)""",Boolean::class.java)!!
        if(!ready) failure("CONTENT_INTEGRATION_NOT_READY","内容授权关联约束尚未就绪")
    }
}
