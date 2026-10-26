package qanda.backend.adminsecurity

import com.fasterxml.jackson.annotation.JsonProperty
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.adminsecurity.api.*
import qanda.backend.authorization.api.Membership
import qanda.backend.authorization.api.MembershipOperations
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.security.CommandDigests
import qanda.backend.platform.transaction.JdbcTransactions
import java.sql.Timestamp
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

data class SetQualification(@param:JsonProperty(required=true) val qualified: Boolean,@param:JsonProperty(required=true) val expectedVersion: Long?)
data class SetAccountStatus(val status: AccountStatus,@param:JsonProperty(required=true) val expectedVersion: Long)
data class QualificationChangeReceipt(val accountId: UUID,val qualified: Boolean,val version: Long,val changed: Boolean,val appliedAt: Instant)
data class AccountStatusReceipt(val accountId: UUID,val status: AccountStatus,val accountVersion: Long,val changed: Boolean,val appliedAt: Instant)
data class AdminQualificationView(val accountId: UUID,val qualified: Boolean,val version: Long,val grantedAt: Instant,val revokedAt: Instant?,val createdAt: Instant,val updatedAt: Instant)
data class AdminAccountView(val accountId: UUID,val accountCode: String,val nickname: String,val status: AccountStatus,val maskedEmail: String?,val createdAt: Instant,val accountVersion: Long,val qualification: AdminQualificationView)
data class AdminUserView(val accountId: UUID,val accountCode: String,val nickname: String,val status: AccountStatus,val maskedEmail: String?,val createdAt: Instant,val accountVersion: Long,val adminEligible: Boolean,val membership: Membership?)
data class AdminSecurityPolicy(val policyVersion: String="MVP-1",val minimumActiveAdministrators: Int=1,val uniformAdminPermissions: Boolean=true,val auditPayloadMode: String="METADATA_ONLY",val minimumAuditRetentionDays: Int=180)
class AdminCommand(val requestId: UUID,val commandId: UUID,val method: String,val path: String,val contentType: String,body: ByteArray) {
    val rawBody=body.clone()
    override fun toString()="AdminCommand([REDACTED])"
}
data class AuditFilters(val from: Instant,val to: Instant,val actorAccountId: UUID?=null,val sourceModule: AuditSource?=null,val action: AuditAction?=null,val outcome: AuditOutcome?=null,val targetType: AuditTarget?=null,val targetId: UUID?=null,val requestId: UUID?=null)

@Service
class AdminService(
    private val jdbc: JdbcTemplate,private val tx: JdbcTransactions,private val identity: IdentityGuards,
    private val access: AdminAccess,private val audits: AdminAuditStore,private val digests: CommandDigests,
    private val accounts: ObjectProvider<AdminIdentityPort>,private val memberships: ObjectProvider<MembershipOperations>,private val clock: Clock,
) {
    internal fun identityPort(): AdminIdentityPort=accounts.ifAvailable ?: dependency()
    private fun <T:Any> root(block: ()->T): T {
        check(!TransactionSynchronizationManager.isActualTransactionActive()) { "Use application guards inside an existing root, not a second HTTP use case" }
        for(attempt in 0..2) {
            try { return tx.required { jdbc.execute("SET LOCAL lock_timeout='3s'");block() } }
            catch(e:PessimisticLockingFailureException) { if(attempt==2) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"TEMPORARILY_UNAVAILABLE","请稍后重试") }
        }
        error("Unreachable")
    }
    private fun now():Instant=clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private data class Context(val actor: GuardedActor,val accounts: AccountGuards,val admin: AdminContext,val qualifications: Map<UUID,QualificationGuard>,val mutation: AdminMutationGuard?)
    private fun context(auth: AuthContext,target: UUID?=null,qualificationWrite: Boolean=false,readTarget: UUID?=null): Context {
        val modes=linkedMapOf(auth.accountId to LockMode.SHARE)
        if(readTarget!=null) modes[readTarget]=LockMode.SHARE
        if(target!=null) modes[target]=LockMode.UPDATE
        val accountGuards=try { identity.lockAccountsInTransaction(modes.map { AccountLock(it.key,it.value) }) }
        catch(error: ApiException) {
            // A missing target must not reveal account existence to an unqualified caller.
            if(error.code=="ACCOUNT_NOT_FOUND" && jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM admin_qualification WHERE account_id=? AND qualified)",Boolean::class.java,auth.accountId)!=true) bad("ADMIN_REQUIRED",HttpStatus.FORBIDDEN)
            throw error
        }
        val sessions=identity.lockSessionsInTransaction(listOf(SessionLock(auth.sessionId)))
        val actor=identity.requireActiveForWrite(auth,accountGuards,sessions,clock.instant())
        val mutation=if(target!=null) access.lockAdminMutationInTransaction(accountGuards) else null
        val qualModes=modes.mapValues { (id,_) -> if(qualificationWrite && id==target) LockMode.UPDATE else LockMode.SHARE }
        val qualifications=access.lockQualificationsInTransaction(accountGuards,qualModes,mutation)
        val admin=access.requireAdminInTransaction(actor,actor.account,qualifications.getValue(auth.accountId))
        return Context(actor,accountGuards,admin,qualifications,mutation)
    }
    private fun page(page: PageSpec) { if(page.page<1 || page.pageSize !in 1..100) bad() }
    private fun checkVersion(expected: Long?,actual: Long?) {
        if(expected!=null && expected !in 1..MAX_VERSION) bad()
        if(expected!=actual) throw ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","资料已更新，请重新读取",details=actual?.let { ErrorDetails(currentVersion=it) })
    }
    private fun next(version: Long): Long { if(version>=MAX_VERSION) bad("VERSION_EXHAUSTED",HttpStatus.CONFLICT);return version+1 }
    private fun receipt(context: Context,command: AdminCommand,operation: String): Map<String,Any?>? {
        val row=jdbc.queryForList("SELECT * FROM admin_command_receipt WHERE actor_account_id=? AND operation=? AND command_request_id=?",context.actor.auth.accountId,operation,command.commandId).singleOrNull() ?: return null
        val expected=row["payload_digest"] as ByteArray
        val actual=digests.digest(command.method,command.path,command.contentType,command.rawBody,(row["digest_key_version"] as Number).toInt())
        if(!digests.matches(expected,actual)) bad("IDEMPOTENCY_CONFLICT",HttpStatus.CONFLICT)
        return row
    }
    private fun saveReceipt(context: Context,command: AdminCommand,operation: String,target: UUID,qualified: Boolean?,status: AccountStatus?,version: Long,changed: Boolean,at: Instant) {
        jdbc.update("""INSERT INTO admin_command_receipt(id,actor_account_id,operation,command_request_id,target_account_id,payload_digest,digest_key_version,qualified_after,account_status_after,resulting_version,changed,applied_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",UUID.randomUUID(),context.actor.auth.accountId,operation,command.commandId,target,
            digests.digest(command.method,command.path,command.contentType,command.rawBody),digests.activeVersion,qualified,status?.name,version,changed,Timestamp.from(at))
    }
    private fun audit(context: Context,requestId: UUID,action: AuditAction,targetType: AuditTarget,targetId: UUID?,changes: List<AuditChange> = emptyList(),at: Instant=now()) {
        val proof=access.accountActorInTransaction(context.actor)
        access.appendAuditInTransaction(listOf(AuditFact(AuditSource.ADMIN_SECURITY,UUID.randomUUID(),proof.actor,action,targetType,targetId,changes=changes)),listOf(proof),requestId,at)
    }
    fun setQualification(auth: AuthContext,target: UUID,request: SetQualification,command: AdminCommand): QualificationChangeReceipt = root {
        val context=context(auth,target,true)
        receipt(context,command,"SET_QUALIFICATION")?.let { return@root QualificationChangeReceipt(it["target_account_id"] as UUID,it["qualified_after"] as Boolean,(it["resulting_version"] as Number).toLong(),it["changed"] as Boolean,(it["applied_at"] as Timestamp).toInstant()) }
        val guard=context.qualifications.getValue(target)
        if(guard.version==null && !request.qualified) bad("NOT_FOUND",HttpStatus.NOT_FOUND)
        checkVersion(request.expectedVersion,guard.version)
        val targetGuard=context.accounts[target]
        if(request.qualified && targetGuard.status!=AccountStatus.ACTIVE) bad("ACCOUNT_NOT_ACTIVE")
        val changed=guard.qualified!=request.qualified
        if(changed) {
            val count=identityPort().countActiveAccountsInTransaction(access.qualifiedScope(context.admin,context.mutation!!),context.admin,context.mutation)
            val delta=if(targetGuard.status==AccountStatus.ACTIVE) { if(request.qualified) 1 else -1 } else 0
            if(count+delta<1) bad("LAST_ADMIN_REQUIRED",HttpStatus.CONFLICT)
        }
        val at=now();val resulting=if(changed) guard.version?.let(::next) ?: 1L else guard.version!!
        if(changed) jdbc.update("""INSERT INTO admin_qualification(account_id,qualified,version,granted_at,revoked_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET qualified=EXCLUDED.qualified,version=EXCLUDED.version,
            granted_at=CASE WHEN EXCLUDED.qualified THEN EXCLUDED.granted_at ELSE admin_qualification.granted_at END,
            revoked_at=EXCLUDED.revoked_at,updated_at=EXCLUDED.updated_at""",target,request.qualified,resulting,Timestamp.from(at),if(request.qualified) null else Timestamp.from(at),Timestamp.from(at),Timestamp.from(at))
        saveReceipt(context,command,"SET_QUALIFICATION",target,request.qualified,null,resulting,changed,at)
        if(changed) audit(context,command.requestId,AuditAction.ADMIN_QUALIFICATION_CHANGED,AuditTarget.ADMIN_QUALIFICATION,target,listOf(
            AuditChange(AuditField.ADMIN_QUALIFIED,guard.version?.let { guard.qualified.toString() },request.qualified.toString()),
            AuditChange(AuditField.RESOURCE_VERSION,guard.version?.toString(),resulting.toString())),at)
        QualificationChangeReceipt(target,request.qualified,resulting,changed,at)
    }
    fun setAccountStatus(auth: AuthContext,target: UUID,request: SetAccountStatus,command: AdminCommand): AccountStatusReceipt = root {
        val context=context(auth,target)
        receipt(context,command,"SET_ACCOUNT_STATUS")?.let { return@root AccountStatusReceipt(it["target_account_id"] as UUID,AccountStatus.valueOf(it["account_status_after"] as String),(it["resulting_version"] as Number).toLong(),it["changed"] as Boolean,(it["applied_at"] as Timestamp).toInstant()) }
        val targetGuard=context.accounts[target];checkVersion(request.expectedVersion,targetGuard.version)
        if(targetGuard.status!=request.status) {
            val count=identityPort().countActiveAccountsInTransaction(access.qualifiedScope(context.admin,context.mutation!!),context.admin,context.mutation)
            val delta=if(context.qualifications.getValue(target).qualified) { if(request.status==AccountStatus.ACTIVE) 1 else -1 } else 0
            if(count+delta<1) bad("LAST_ADMIN_REQUIRED",HttpStatus.CONFLICT)
        }
        val at=now()
        val result=identityPort().setAccountStatus(access.statusProof(context.admin,targetGuard,context.mutation!!,request.status),target,request.status,request.expectedVersion,at)
        saveReceipt(context,command,"SET_ACCOUNT_STATUS",target,null,result.status,result.accountVersion,result.changed,at)
        if(result.changed) audit(context,command.requestId,AuditAction.ACCOUNT_STATUS_CHANGED,AuditTarget.ACCOUNT,target,result.auditChanges.map { AuditChange(AuditField.valueOf(it.field),it.beforeValue,it.afterValue) },at)
        AccountStatusReceipt(result.accountId,result.status,result.accountVersion,result.changed,at)
    }
    fun listAdministrators(auth: AuthContext,qualified: Boolean,page: PageSpec,requestId: UUID): Page<AdminAccountView> = root {
        page(page);val context=context(auth)
        val rows=paged("admin_qualification","qualified=?",listOf(qualified),"created_at DESC,account_id ASC",page)
        val records=rows.filter { it["account_id"]!=null }
        val ids=records.map { it["account_id"] as UUID }
        val labels=if(ids.isEmpty()) emptyMap() else identityPort().readAccountSummaries(ids,context.admin).associateBy { it.accountId }
        val items=records.map { row ->
            val q=qualification(row);val label=labels[q.accountId] ?: dependency()
            AdminAccountView(label.accountId,label.accountCode,label.nickname,label.status,label.maskedEmail,label.createdAt,label.accountVersion,q)
        }
        audit(context,requestId,AuditAction.ADMIN_METADATA_READ,AuditTarget.QUERY,null)
        Page(items,page.page,page.pageSize,(rows.first()["total"] as Number).toLong())
    }
    fun listUsers(auth: AuthContext,filters: AccountFilters,page: PageSpec,requestId: UUID): Page<AdminUserView> = root {
        page(page);val context=context(auth)
        val users=identityPort().listAccountSummariesForAdministrationInTransaction(context.admin,filters,page)
        val items=combineUsers(users.items,context)
        audit(context,requestId,AuditAction.ADMIN_METADATA_READ,AuditTarget.QUERY,null)
        Page(items,users.page,users.pageSize,users.totalItems)
    }
    fun getUser(auth: AuthContext,target: UUID,requestId: UUID): AdminUserView = root {
        val context=context(auth,readTarget=target)
        val summary=identityPort().readAccountSummaries(listOf(target),context.admin).singleOrNull() ?: bad("NOT_FOUND",HttpStatus.NOT_FOUND)
        val item=combineUsers(listOf(summary),context).single()
        audit(context,requestId,AuditAction.ADMIN_METADATA_READ,AuditTarget.ACCOUNT,target)
        item
    }
    private fun combineUsers(users: List<AccountSummary>,context: Context): List<AdminUserView> {
        if(users.isEmpty()) return emptyList()
        check(users.size<=100 && users.map { it.accountId }.distinct().size==users.size)
        val ids=users.map { it.accountId }
        val members=(memberships.ifAvailable ?: dependency()).readMembershipSummariesInTransaction(ids,context.admin)
        check(members.map { it.accountId }==ids && members.all { it.membership==null || it.membership.accountId==it.accountId }) { "Invalid membership projection" }
        val placeholders=ids.joinToString(",") { "?" }
        val qualified=jdbc.queryForList("SELECT account_id FROM admin_qualification WHERE qualified AND account_id IN ($placeholders)",*ids.toTypedArray()).map { it["account_id"] as UUID }.toSet()
        return users.zip(members).map { (u,m) -> AdminUserView(u.accountId,u.accountCode,u.nickname,u.status,u.maskedEmail,u.createdAt,u.accountVersion,u.status==AccountStatus.ACTIVE && u.accountId in qualified,m.membership) }
    }
    fun readPolicy(auth: AuthContext,requestId: UUID): AdminSecurityPolicy = root {
        val context=context(auth);audit(context,requestId,AuditAction.ADMIN_METADATA_READ,AuditTarget.QUERY,null);AdminSecurityPolicy()
    }
    fun listAudit(auth: AuthContext,filters: AuditFilters,page: PageSpec,requestId: UUID): Page<AuditEntrySummary> = root {
        page(page);val context=context(auth)
        if(filters.to.isBefore(filters.from) || filters.to.isAfter(filters.from.plus(31,ChronoUnit.DAYS)) || filters.targetId!=null && filters.targetType==null) bad()
        val clauses=mutableListOf("occurred_at>=?","occurred_at<?")
        val args=mutableListOf<Any>(Timestamp.from(filters.from),Timestamp.from(filters.to))
        for((field,value) in listOf("actor_account_id" to filters.actorAccountId,"source_module" to filters.sourceModule?.name,"action" to filters.action?.name,"outcome" to filters.outcome?.name,"target_type" to filters.targetType?.name,"target_id" to filters.targetId,"request_id" to filters.requestId)) if(value!=null) { clauses+="$field=?";args+=value }
        val rows=paged("admin_audit_entry",clauses.joinToString(" AND "),args,"occurred_at DESC,id DESC",page)
        val items=rows.filter { it["id"]!=null }.map(audits::summary)
        audit(context,requestId,AuditAction.AUDIT_READ,AuditTarget.QUERY,null)
        Page(items,page.page,page.pageSize,(rows.first()["total"] as Number).toLong())
    }
    fun getAudit(auth: AuthContext,id: UUID,requestId: UUID): AuditEntryDetail = root {
        val context=context(auth)
        val item=audits.detail(id) ?: bad("NOT_FOUND",HttpStatus.NOT_FOUND)
        audit(context,requestId,AuditAction.AUDIT_READ,AuditTarget.AUDIT_ENTRY,id)
        item
    }
    private fun qualification(row: Map<String,Any?>) = AdminQualificationView(row["account_id"] as UUID,row["qualified"] as Boolean,(row["version"] as Number).toLong(),(row["granted_at"] as Timestamp).toInstant(),(row["revoked_at"] as Timestamp?)?.toInstant(),(row["created_at"] as Timestamp).toInstant(),(row["updated_at"] as Timestamp).toInstant())
    private fun paged(table: String,where: String,args: List<Any>,order: String,page: PageSpec): List<Map<String,Any?>> = jdbc.queryForList("""WITH filtered AS (SELECT * FROM $table WHERE $where),
        counted AS (SELECT count(*) AS total FROM filtered), paged AS (SELECT * FROM filtered ORDER BY $order LIMIT ? OFFSET ?)
        SELECT counted.total,paged.* FROM counted LEFT JOIN paged ON true ORDER BY $order""",*(args+page.pageSize+((page.page.toLong()-1)*page.pageSize)).toTypedArray())
}
