package qanda.backend.adminsecurity

import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import qanda.backend.adminsecurity.api.*
import qanda.backend.identity.IdentityGuards
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.transaction.JdbcTransactions
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

data class AuditEntrySummary(
    val id: UUID, val sourceModule: AuditSource, val eventId: UUID, val actor: AuditActor,
    val action: AuditAction, val targetType: AuditTarget, val targetId: UUID?, val recordKind: AuditRecordKind?,
    val relatedRecordId: UUID?, val outcome: AuditOutcome, val reasonCode: String?, val requestId: UUID, val occurredAt: Instant,
)
data class AuditEntryDetail(
    val id: UUID, val sourceModule: AuditSource, val eventId: UUID, val actor: AuditActor,
    val action: AuditAction, val targetType: AuditTarget, val targetId: UUID?, val recordKind: AuditRecordKind?,
    val relatedRecordId: UUID?, val outcome: AuditOutcome, val reasonCode: String?, val requestId: UUID,
    val occurredAt: Instant, val changes: List<AuditChange>,
)

@Service
class AdminAuditStore(private val jdbc: JdbcTemplate,private val tx: JdbcTransactions,private val identity: IdentityGuards) {
    private val identityActions=setOf(AuditAction.ACCOUNT_REGISTERED,AuditAction.LOGIN_SUCCEEDED,AuditAction.CREDENTIAL_CHANGED,AuditAction.IDENTITY_BOUND,AuditAction.SESSION_REVOKED,AuditAction.AUTH_RATE_LIMITED)
    private val authorizationActions=setOf(AuditAction.MEMBERSHIP_CHANGED,AuditAction.ORGANIZATION_CHANGED,AuditAction.SCHOOL_ACCESS_CHANGED,AuditAction.USER_SHARE_CHANGED)
    private val maintenance=setOf(AuditAction.ANALYTICS_REBUILD_STARTED,AuditAction.ANALYTICS_REBUILD_ACTIVATED,AuditAction.ANALYTICS_REBUILD_FAILED)
    private val versions=setOf(AuditField.RESOURCE_VERSION,AuditField.CREDENTIAL_VERSION)
    private val maintenanceReasons=setOf("REBUILD_ABORTED","REBUILD_BASE_TIMEOUT","REBUILD_SOURCE_UNAVAILABLE","REBUILD_INTEGRITY_FAILED","REBUILD_LEASE_LOST","REBUILD_STORAGE_FAILURE","AUDIT_UNAVAILABLE")

    fun appendAuditInTransaction(facts: List<AuditFact>,proofs: List<ActorProof>,requestId: UUID,now: Instant): AppendAuditResult = tx.mandatory {
        check(facts.size in 1..100)
        val transactionId=identity.currentTransactionId()
        facts.forEach { fact ->
            val proof=proofs.firstOrNull { it.actor==fact.actor && it.transactionId==transactionId && (it.actor.kind!=ActorKind.LOCAL_OPERATOR || it.generationId==fact.targetId) } ?: error("Missing actor proof")
            proof.verify();validate(fact,proof)
        }
        identity.advanceLockPhaseInTransaction(80)
        try {
            val ids=linkedMapOf<Pair<AuditSource,UUID>,UUID>()
            for (fact in facts.sortedWith(compareBy({ it.sourceModule.name },{ it.eventId.toString() }))) {
                val proposed=UUID.randomUUID()
                val inserted=jdbc.update("""INSERT INTO admin_audit_entry
                    (id,source_module,event_id,actor_kind,actor_account_id,action,target_type,target_id,record_kind,related_record_id,outcome,reason_code,request_id,occurred_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_module,event_id) DO NOTHING""",
                    proposed,fact.sourceModule.name,fact.eventId,fact.actor.kind.name,fact.actor.accountId,fact.action.name,fact.targetType.name,fact.targetId,
                    fact.recordKind?.name,fact.relatedRecordId,fact.outcome.name,fact.reasonCode,requestId,Timestamp.from(now))
                val id=if(inserted==1) {
                    for(change in fact.changes.sortedBy { it.field.name }) jdbc.update("INSERT INTO admin_audit_change VALUES (?,?,?,?)",proposed,change.field.name,change.beforeValue,change.afterValue)
                    proposed
                } else {
                    val existing=jdbc.queryForList("SELECT * FROM admin_audit_entry WHERE source_module=? AND event_id=?",fact.sourceModule.name,fact.eventId).single()
                    val summary=summary(existing)
                    val saved=AuditFact(summary.sourceModule,summary.eventId,summary.actor,summary.action,summary.targetType,summary.targetId,summary.recordKind,summary.relatedRecordId,summary.outcome,summary.reasonCode,changes(summary.id))
                    if(saved.copy(changes=saved.changes.sortedBy { it.field.name })!=fact.copy(changes=fact.changes.sortedBy { it.field.name })) bad("AUDIT_EVENT_CONFLICT",HttpStatus.CONFLICT)
                    summary.id
                }
                ids[fact.sourceModule to fact.eventId]=id
            }
            AppendAuditResult(facts.map { ids.getValue(it.sourceModule to it.eventId) })
        } catch(_:DataAccessException) {
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,"AUDIT_UNAVAILABLE","审计记录暂时无法保存")
        }
    }
    private fun validate(fact: AuditFact,proof: ActorProof) {
        require((fact.actor.kind==ActorKind.ACCOUNT)==(fact.actor.accountId!=null)) { "Invalid actor shape" }
        require(fact.changes.size<=8 && fact.changes.map { it.field }.distinct().size==fact.changes.size)
        require((fact.targetType in setOf(AuditTarget.QUERY,AuditTarget.SYSTEM)) || fact.targetId!=null)
        require((fact.recordKind==null)==(fact.relatedRecordId==null))
        require((fact.outcome==AuditOutcome.FAILURE)==(fact.reasonCode!=null))
        require((fact.action in setOf(AuditAction.SECURITY_REJECTED,AuditAction.ANALYTICS_REBUILD_FAILED))==(fact.outcome==AuditOutcome.FAILURE))
        require(fact.reasonCode==null || fact.reasonCode.matches(Regex("[A-Z][A-Z0-9_]{0,63}")))
        val source=when(fact.action) {
            in identityActions -> AuditSource.IDENTITY
            in authorizationActions -> AuditSource.AUTHORIZATION
            AuditAction.CONTENT_CHANGED,AuditAction.CONTENT_IMPORT_COMMITTED -> AuditSource.CONTENT
            AuditAction.PRACTICE_COMPLETED,AuditAction.PRACTICE_RESTRICTED_ARCHIVED -> AuditSource.PRACTICE
            AuditAction.STUDENT_RECORDS_READ -> AuditSource.LEARNING
            AuditAction.ADMIN_SUMMARY_READ -> AuditSource.ANALYTICS
            in maintenance -> AuditSource.ANALYTICS
            AuditAction.SECURITY_REJECTED -> fact.sourceModule
            else -> AuditSource.ADMIN_SECURITY
        }
        require(fact.sourceModule==source)
        val targets=when(fact.action) {
            AuditAction.ADMIN_QUALIFICATION_CHANGED -> setOf(AuditTarget.ADMIN_QUALIFICATION)
            AuditAction.LOGIN_SUCCEEDED -> setOf(AuditTarget.AUTH_SESSION)
            AuditAction.SESSION_REVOKED -> setOf(AuditTarget.AUTH_SESSION,AuditTarget.ACCOUNT)
            AuditAction.AUTH_RATE_LIMITED,AuditAction.SECURITY_REJECTED -> setOf(AuditTarget.ACCOUNT,AuditTarget.SYSTEM)
            AuditAction.MEMBERSHIP_CHANGED -> setOf(AuditTarget.MEMBERSHIP)
            AuditAction.ORGANIZATION_CHANGED -> setOf(AuditTarget.COLLEGE,AuditTarget.MAJOR)
            AuditAction.SCHOOL_ACCESS_CHANGED,AuditAction.USER_SHARE_CHANGED -> setOf(AuditTarget.SUBJECT)
            AuditAction.CONTENT_CHANGED -> setOf(AuditTarget.SUBJECT,AuditTarget.CHAPTER,AuditTarget.QUESTION)
            AuditAction.CONTENT_IMPORT_COMMITTED -> setOf(AuditTarget.IMPORT_BATCH)
            AuditAction.PRACTICE_COMPLETED,AuditAction.PRACTICE_RESTRICTED_ARCHIVED -> setOf(AuditTarget.PRACTICE_SESSION)
            AuditAction.STUDENT_RECORDS_READ,AuditAction.ADMIN_SUMMARY_READ,AuditAction.ADMIN_METADATA_READ -> setOf(AuditTarget.ACCOUNT,AuditTarget.QUERY)
            AuditAction.AUDIT_READ -> setOf(AuditTarget.AUDIT_ENTRY,AuditTarget.QUERY)
            in maintenance -> setOf(AuditTarget.ANALYTICS_GENERATION)
            else -> setOf(AuditTarget.ACCOUNT)
        }
        require(fact.targetType in targets)
        val fields=when(fact.action) {
            AuditAction.ADMIN_BOOTSTRAPPED,AuditAction.ADMIN_QUALIFICATION_CHANGED -> setOf(AuditField.ADMIN_QUALIFIED,AuditField.RESOURCE_VERSION)
            AuditAction.ACCOUNT_STATUS_CHANGED -> versions+AuditField.ACCOUNT_STATUS
            AuditAction.CREDENTIAL_CHANGED,AuditAction.IDENTITY_BOUND,AuditAction.ACCOUNT_REGISTERED,AuditAction.SESSION_REVOKED -> versions
            AuditAction.MEMBERSHIP_CHANGED -> setOf(AuditField.COLLEGE_ID,AuditField.MAJOR_ID,AuditField.RESOURCE_VERSION)
            AuditAction.ORGANIZATION_CHANGED,AuditAction.USER_SHARE_CHANGED -> setOf(AuditField.RESOURCE_VERSION)
            AuditAction.SCHOOL_ACCESS_CHANGED -> setOf(AuditField.COLLEGE_ID,AuditField.MAJOR_ID,AuditField.IS_PUBLIC,AuditField.RESOURCE_VERSION)
            AuditAction.CONTENT_CHANGED -> setOf(AuditField.RESOURCE_STATUS,AuditField.RESOURCE_VERSION)
            AuditAction.CONTENT_IMPORT_COMMITTED -> setOf(AuditField.RESOURCE_VERSION)
            else -> emptySet()
        }
        require(fact.changes.all { it.field in fields })
        for(change in fact.changes) {
            require(change.beforeValue!=change.afterValue)
            for(value in listOfNotNull(change.beforeValue,change.afterValue)) require(when(change.field) {
                AuditField.ACCOUNT_STATUS -> value in setOf("ACTIVE","DISABLED")
                AuditField.ADMIN_QUALIFIED,AuditField.IS_PUBLIC -> value in setOf("true","false")
                AuditField.RESOURCE_STATUS -> value in setOf("ACTIVE","INACTIVE")
                AuditField.COLLEGE_ID,AuditField.MAJOR_ID -> runCatching { UUID.fromString(value).toString()==value }.getOrDefault(false)
                AuditField.RESOURCE_VERSION,AuditField.CREDENTIAL_VERSION -> value.matches(Regex("[1-9][0-9]{0,15}")) && (value.toLongOrNull() ?: 0) in 1..MAX_VERSION
            })
        }
        val expectedRecord=when(fact.action) {
            AuditAction.PRACTICE_COMPLETED -> AuditRecordKind.COMPLETED
            AuditAction.PRACTICE_RESTRICTED_ARCHIVED -> AuditRecordKind.RESTRICTED_ARCHIVED
            else -> null
        }
        require(fact.recordKind==expectedRecord)
        if(fact.action in maintenance) {
            require(fact.actor.kind==ActorKind.LOCAL_OPERATOR && proof.localPurpose=="ANALYTICS_REBUILD" && proof.generationId==fact.targetId)
            if(fact.action==AuditAction.ANALYTICS_REBUILD_FAILED) require(fact.outcome==AuditOutcome.FAILURE && fact.reasonCode in maintenanceReasons)
            else require(fact.outcome==AuditOutcome.SUCCESS)
        } else if(fact.action==AuditAction.ADMIN_BOOTSTRAPPED) {
            require(fact.actor.kind==ActorKind.LOCAL_OPERATOR && proof.localPurpose=="BOOTSTRAP" && proof.generationId==fact.targetId)
        } else if(fact.actor.kind==ActorKind.LOCAL_OPERATOR) error("Local operator cannot impersonate account operations")
        if(fact.actor.kind==ActorKind.SYSTEM) require(fact.action in setOf(AuditAction.AUTH_RATE_LIMITED,AuditAction.SECURITY_REJECTED))
    }
    internal fun changes(id: UUID): List<AuditChange> = jdbc.queryForList("SELECT * FROM admin_audit_change WHERE audit_entry_id=? ORDER BY field",id).map {
        AuditChange(AuditField.valueOf(it["field"] as String),it["before_value"] as String?,it["after_value"] as String?)
    }
    internal fun summary(row: Map<String,Any?>) = AuditEntrySummary(
        row["id"] as UUID,AuditSource.valueOf(row["source_module"] as String),row["event_id"] as UUID,
        AuditActor(ActorKind.valueOf(row["actor_kind"] as String),row["actor_account_id"] as UUID?),AuditAction.valueOf(row["action"] as String),
        AuditTarget.valueOf(row["target_type"] as String),row["target_id"] as UUID?,(row["record_kind"] as String?)?.let(AuditRecordKind::valueOf),
        row["related_record_id"] as UUID?,AuditOutcome.valueOf(row["outcome"] as String),row["reason_code"] as String?,row["request_id"] as UUID,(row["occurred_at"] as Timestamp).toInstant(),
    )
    internal fun detail(id: UUID): AuditEntryDetail? {
        val rows=jdbc.queryForList("SELECT e.*,c.field,c.before_value,c.after_value FROM admin_audit_entry e LEFT JOIN admin_audit_change c ON c.audit_entry_id=e.id WHERE e.id=? ORDER BY c.field",id)
        val r=rows.firstOrNull()?.let(::summary) ?: return null
        val changes=rows.filter { it["field"]!=null }.map { AuditChange(AuditField.valueOf(it["field"] as String),it["before_value"] as String?,it["after_value"] as String?) }
        return AuditEntryDetail(r.id,r.sourceModule,r.eventId,r.actor,r.action,r.targetType,r.targetId,r.recordKind,r.relatedRecordId,r.outcome,r.reasonCode,r.requestId,r.occurredAt,changes)
    }
}
