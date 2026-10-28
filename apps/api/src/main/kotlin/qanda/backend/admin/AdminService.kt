package qanda.backend.admin

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.identity.*
import qanda.backend.platform.http.*
import qanda.backend.platform.http.invalid
import qanda.backend.platform.http.conflict
import qanda.backend.platform.persistence.SystemMapper
import qanda.backend.platform.security.*
import java.time.Clock
import java.util.Locale
import java.util.UUID

@Service
@Transactional
class AdminService(private val rows: AdminAccountMapper,private val sessionRows: AdminSessionMapper,private val policies: SecurityPolicyMapper,
                   private val sql: AdminQueries,private val identity: IdentityMapper,private val users: UserAccountMapper,
                   private val identityViews: IdentityService,private val system: SystemMapper,
                   private val crypto: IdentityCrypto,private val attempts: LoginAttempts,private val clock: Clock) {
    fun view(row: AdminAccount)=AdminView(row.id!!,row.username,row.name,row.role,if(row.status=="INACTIVE") "DISABLED" else row.status,row.version,row.createdAt,row.lastLoginAt)
    fun current(actor: Actor): AdminView = view(rows.selectById(actor.id) ?: missing())
    fun user(id: UUID): UserView = identityViews.view(id)
    fun username(value: String)=value.trim().lowercase(Locale.ROOT).also { if(!it.matches(Regex("[a-z0-9_.-]{3,64}"))) invalid("/username") }
    private fun password(raw: String): String {
        val policy=policies.selectById(1)
        if(raw.codePointCount(0,raw.length)<policy.minPasswordLength || policy.requireLetter && raw.none { it.isLetter() } || policy.requireNumber && raw.none { it.isDigit() }
            || policy.requireMixedCase && (raw.none { it.isUpperCase() } || raw.none { it.isLowerCase() })) invalid("/password")
        return crypto.preparePassword(raw).encoded
    }
    fun login(input: AdminLoginInput): TokenView {
        val key=username(input.username);val scope="admin:$key";val policy=policies.selectById(1)
        if(policy.lockEnabled && attempts.blocked(scope)) throw ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"LOGIN_LOCKED","账号暂时锁定",details=ErrorDetails(retryAfterSeconds=policy.lockMinutes*60))
        val account=sql.byUsername(key)
        if(!crypto.verifyPassword(input.password,account?.passwordHash) || account?.status!="ACTIVE") {
            attempts.failure(scope,policy.maxAttempts,policy.lockMinutes,policy.lockEnabled);unauthenticated()
        }
        val current=identity.lockAdmin(account!!.id!!) ?: unauthenticated()
        if(current.status!="ACTIVE" || current.credentialVersion!=account.credentialVersion) unauthenticated()
        attempts.clear(scope)
        val token="a_"+crypto.randomToken();val session=AdminSession().apply { id=UUID.randomUUID();adminId=account.id;tokenDigest=crypto.tokenDigest(token)
            credentialVersion=account.credentialVersion;deviceId=input.deviceId;issuedAt=clock.instant();lastSeenAt=issuedAt;expiresAt=issuedAt.plusSeconds(86400) }
        sessionRows.insert(session);account.lastLoginAt=clock.instant();rows.updateById(account)
        return TokenView(token,session.id!!,session.expiresAt)
    }
    fun list(page: PageSpec): Page<AdminView> {
        val result=rows.selectPage(com.baomidou.mybatisplus.extension.plugins.pagination.Page(page.page.toLong(),page.pageSize.toLong()),QueryWrapper<AdminAccount>().orderByDesc("created_at").orderByAsc("id"))
        return Page(result.records.map(::view),result.total,page.page,page.pageSize)
    }
    fun listUsers(keyword: String?,collegeId: UUID?,majorId: UUID?,status: String?,page: PageSpec): Page<UserView> {
        val result=sql.userPage(keyword,collegeId,majorId,status,page.offset,page.pageSize).map { identityViews.view(it.id!!) }
        return Page(result,sql.userCount(keyword,collegeId,majorId,status),page.page,page.pageSize)
    }
    fun auditLogs(page: PageSpec): Page<AuditView> {
        val items=system.auditPage(page.offset,page.pageSize).map { AuditView(it.id!!,it.actorUserId,it.actorAdminId,it.operation,it.outcome,it.reasonCode,it.requestId!!,it.createdAt) }
        return Page(items,system.auditCount(),page.page,page.pageSize)
    }
    fun save(id: UUID?,input: AdminInput): MutationResult {
        sql.lockControl()
        if(input.role !in setOf("PLATFORM_ADMIN","CONTENT_ADMIN")) invalid("/role")
        val status=when(input.status) { "ACTIVE" -> "ACTIVE";"DISABLED" -> "INACTIVE";else -> invalid("/status") }
        val old=id?.let { identity.lockAdmin(it) ?: missing() }
        old?.let { requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),it.version) }
        if(old?.role=="PLATFORM_ADMIN" && old.status=="ACTIVE" && (input.role!="PLATFORM_ADMIN" || input.status!="ACTIVE") && sql.platformCount()<=1) conflict("LAST_PLATFORM_ADMIN","至少保留一个有效的平台管理员")
        val hash=input.password?.let(::password) ?: old?.passwordHash ?: invalid("/password")
        val oldRole=old?.role
        val row=old ?: AdminAccount().apply { this.id=UUID.randomUUID() }
        row.username=username(input.username);row.name=name(input.name,40);row.role=input.role;row.status=status
        val credentialsChanged=old!=null && (input.password!=null || row.status!="ACTIVE" || row.role!=oldRole)
        row.passwordHash=hash;row.version=if(old==null) 1 else row.version+1;row.updatedAt=clock.instant()
        if(credentialsChanged) { row.credentialVersion++;identity.revokeAdminSessions(row.id!!) }
        if(old==null) rows.insert(row) else rows.updateById(row)
        return MutationResult(row.id!!,row.version)
    }
    fun disable(id: UUID,expectedVersion: Long): MutationResult {
        val old=rows.selectById(id) ?: missing()
        return save(id,AdminInput(old.username,old.name,old.role,"DISABLED",expectedVersion=expectedVersion))
    }
    fun bootstrap(username: String,name: String,password: String): UUID {
        if(sql.lockControl()!=null || sql.platformCount()>0) conflict("BOOTSTRAP_COMPLETED","首个管理员已创建")
        val result=save(null,AdminInput(username,name,"PLATFORM_ADMIN",password=password));sql.completeBootstrap();return result.id
    }
    fun policy(): PolicyView=policies.selectById(1).let { PolicyView(it.lockEnabled,it.maxAttempts,it.lockMinutes,it.sessionMinutes,it.minPasswordLength,it.requireLetter,it.requireNumber,it.requireMixedCase,it.version,it.updatedAt) }
    fun policy(input: PolicyInput): PolicyView {
        sql.lockControl();val row=policies.selectById(1);requireVersion(input.expectedVersion,row.version)
        if(input.newDeviceVerification || input.changeInitialPassword) invalid("/policy","UNSUPPORTED_SECURITY_POLICY","当前安全策略不支持启用该项")
        if(input.maxAttempts !in 3..10 || input.lockMinutes !in 1..1440 || input.sessionMinutes !in 5..1440 || input.minPasswordLength !in 12..64) invalid("/policy")
        row.lockEnabled=input.lockEnabled;row.maxAttempts=input.maxAttempts;row.lockMinutes=input.lockMinutes;row.sessionMinutes=input.sessionMinutes
        row.minPasswordLength=input.minPasswordLength;row.requireLetter=input.requireLetter;row.requireNumber=input.requireNumber;row.requireMixedCase=input.requireMixedCase
        row.version++;row.updatedAt=clock.instant();policies.updateById(row);return policy()
    }
    fun userStatus(id: UUID,input: AccountStatusInput): MutationResult {
        if(input.status !in setOf("ACTIVE","DISABLED")) invalid("/status")
        val row=identity.lockUser(id) ?: missing();requireVersion(input.expectedVersion,row.version)
        row.status=input.status;row.version++;row.credentialVersion++;row.updatedAt=clock.instant();users.updateById(row);identity.revokeUserSessions(id)
        return MutationResult(id,row.version)
    }
    fun logout(actor: Actor): MutationResult {
        val session=identity.lockAdminSession(actor.sessionId) ?: missing();session.revokedAt=clock.instant();sessionRows.updateById(session)
        return MutationResult(session.id!!,1)
    }
}
