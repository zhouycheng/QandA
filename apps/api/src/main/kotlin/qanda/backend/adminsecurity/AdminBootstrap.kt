package qanda.backend.adminsecurity

import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.adminsecurity.api.*
import qanda.backend.identity.api.PreparedPassword
import qanda.backend.identity.api.RegistrationResult
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.io.Console
import java.sql.Timestamp
import java.time.Clock
import java.time.temporal.ChronoUnit
import java.util.Arrays
import java.util.UUID

@Service
class AdminBootstrapService(private val jdbc: JdbcTemplate,private val tx: JdbcTransactions,private val service: AdminService,private val access: AdminAccess,private val clock: Clock) {
    fun assertAvailable() {
        val control=jdbc.queryForList("SELECT bootstrap_completed_at FROM admin_control WHERE singleton_id=1").singleOrNull() ?: dependency()
        if(control["bootstrap_completed_at"]!=null || jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM admin_qualification)",Boolean::class.java)==true) bad("BOOTSTRAP_CLOSED",HttpStatus.CONFLICT)
    }
    fun bootstrap(challengeId: UUID,code: String,prepared: PreparedPassword,nickname: String?,operator: LocalOperatorProof,requestId: UUID): RegistrationResult {
        check(!TransactionSynchronizationManager.isActualTransactionActive() && operator.purpose=="BOOTSTRAP")
        try {
            return tx.required {
                jdbc.execute("SET LOCAL lock_timeout='3s'")
                val control=jdbc.queryForList("SELECT bootstrap_completed_at FROM admin_control WHERE singleton_id=1 FOR UPDATE").singleOrNull() ?: dependency()
                if(control["bootstrap_completed_at"]!=null || jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM admin_qualification)",Boolean::class.java)==true) bad("BOOTSTRAP_CLOSED",HttpStatus.CONFLICT)
                val at=clock.instant().truncatedTo(ChronoUnit.MILLIS)
                val result=service.identityPort().createBootstrapIdentityInTransaction(challengeId,code,prepared,nickname,at)
                jdbc.update("INSERT INTO admin_qualification(account_id,qualified,version,granted_at,created_at,updated_at) VALUES (?,true,1,?,?,?)",result.accountId,Timestamp.from(at),Timestamp.from(at),Timestamp.from(at))
                jdbc.update("UPDATE admin_control SET bootstrap_completed_at=? WHERE singleton_id=1",Timestamp.from(at))
                val proof=access.localActor(operator,result.accountId)
                access.appendAuditInTransaction(listOf(AuditFact(AuditSource.ADMIN_SECURITY,UUID.randomUUID(),proof.actor,AuditAction.ADMIN_BOOTSTRAPPED,AuditTarget.ACCOUNT,result.accountId,
                    changes=listOf(AuditChange(AuditField.ADMIN_QUALIFIED,null,"true"),AuditChange(AuditField.RESOURCE_VERSION,null,"1")))),listOf(proof),requestId,at)
                result
            }
        } catch(error: ApiException) {
            if(error.code=="VERIFICATION_FAILED") runCatching { service.identityPort().recordBootstrapFailure(challengeId,code) }
            throw error
        } catch(_:DataAccessException) {
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"TEMPORARILY_UNAVAILABLE","首管初始化暂时无法完成")
        }
    }
}

/** Explicit local entry; the root launcher assembles this component in a non-web context. */
@Component
class AdminBootstrapCommand(private val bootstrap: AdminBootstrapService,private val service: AdminService) {
    fun runInteractive(console: Console = System.console() ?: error("请使用本地交互终端")): RegistrationResult {
        bootstrap.assertAvailable()
        val email=console.readLine("验证邮箱：") ?: error("输入已取消")
        val challenge=service.identityPort().requestPublicEmailChallenge(email)
        var code=charArrayOf();var password=charArrayOf();var confirmation=charArrayOf()
        try {
            code=console.readPassword("邮箱验证码：") ?: error("输入已取消")
            password=console.readPassword("密码：") ?: error("输入已取消")
            confirmation=console.readPassword("确认密码：") ?: error("输入已取消")
            require(Arrays.equals(password,confirmation)) { "两次输入的密码不一致" }
            val prepared=service.identityPort().prepareLocalBootstrapPassword(String(password))
            val result=bootstrap.bootstrap(challenge.challengeId,String(code),prepared,null,LocalOperatorProof("BOOTSTRAP",UUID.randomUUID()),UUID.randomUUID())
            console.printf("已建立管理员 %s（%s），请通过正常身份入口登录。%n",result.accountCode,result.accountId)
            return result
        } finally { Arrays.fill(code,'\u0000');Arrays.fill(password,'\u0000');Arrays.fill(confirmation,'\u0000') }
    }
}
