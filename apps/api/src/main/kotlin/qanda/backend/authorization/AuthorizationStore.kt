package qanda.backend.authorization

import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionSynchronizationManager
import qanda.backend.authorization.api.*
import qanda.backend.platform.http.ApiException
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

internal fun missing(): Nothing = throw ApiException(HttpStatus.NOT_FOUND,"NOT_FOUND","对象不存在或无访问权限")
internal fun failure(code: String, message: String): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,code,message)
internal fun ResultSet.uuid(name: String): UUID = getObject(name, UUID::class.java)
internal fun ResultSet.instant(name: String): Instant = getTimestamp(name).toInstant()
internal fun Instant.sql() = Timestamp.from(this)

@Repository
class AuthorizationStore(val jdbc: JdbcTemplate) {
    internal val collegeMapper = RowMapper { r, _ -> College(r.uuid("college_id"),r.getString("name"),OrganizationStatus.valueOf(r.getString("status")),r.getLong("version"),r.instant("created_at"),r.instant("updated_at")) }
    internal val majorMapper = RowMapper { r, _ -> Major(r.uuid("major_id"),r.uuid("college_id"),r.getString("name"),OrganizationStatus.valueOf(r.getString("status")),r.getLong("version"),r.instant("created_at"),r.instant("updated_at")) }
    internal val membershipMapper = RowMapper { r, _ -> Membership(r.uuid("account_id"),r.uuid("college_id"),r.getString("college_name"),r.uuid("major_id"),r.getString("major_name"),r.getBoolean("organization_active"),r.getLong("version"),r.instant("established_at"),r.instant("updated_at")) }
    private val membershipQuery = """SELECT m.*,a.college_id,a.name major_name,c.name college_name,(a.status='ACTIVE' AND c.status='ACTIVE') organization_active
        FROM authz_membership m JOIN authz_major a ON a.major_id=m.major_id JOIN authz_college c ON c.college_id=a.college_id"""

    fun connection(): Any {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "Authorization requires current transaction" }
        return requireNotNull(TransactionSynchronizationManager.getResource(requireNotNull(jdbc.dataSource))) { "No transaction-bound connection" }
    }
    fun assertConnection(connection: Any) { check(connection === connection()) { "Authorization guard belongs to another transaction" } }
    fun college(id: UUID): College = jdbc.query("SELECT * FROM authz_college WHERE college_id=?",collegeMapper,id).singleOrNull() ?: missing()
    fun major(id: UUID): Major = jdbc.query("SELECT * FROM authz_major WHERE major_id=?",majorMapper,id).singleOrNull() ?: missing()
    fun lockOrganizations(collegeModes: Map<UUID,GuardMode>, majorModes: Map<UUID,GuardMode>) {
        connection()
        collegeModes.toSortedMap(compareBy(UUID::toString)).forEach { (id,mode) ->
            if(jdbc.queryForList("SELECT college_id FROM authz_college WHERE college_id=? FOR ${mode.sqlLock()}",id).isEmpty()) missing()
        }
        majorModes.toSortedMap(compareBy(UUID::toString)).forEach { (id,mode) ->
            if(jdbc.queryForList("SELECT major_id FROM authz_major WHERE major_id=? FOR ${mode.sqlLock()}",id).isEmpty()) missing()
        }
    }
    fun membership(accountId: UUID): Membership? = jdbc.query("$membershipQuery WHERE m.account_id=?",membershipMapper,accountId).singleOrNull()
    fun membershipSummaries(ids: List<UUID>): List<MembershipSummary> {
        connection()
        val placeholders = ids.joinToString(",") { "(?)" }
        val sql = """WITH requested(account_id) AS (VALUES $placeholders)
            SELECT q.account_id requested_id,m.account_id,m.major_id,m.version,m.established_at,m.updated_at,
            a.college_id,a.name major_name,c.name college_name,(a.status='ACTIVE' AND c.status='ACTIVE') organization_active
            FROM requested q LEFT JOIN authz_membership m ON m.account_id=q.account_id
            LEFT JOIN authz_major a ON a.major_id=m.major_id LEFT JOIN authz_college c ON c.college_id=a.college_id"""
        val rows = jdbc.query(sql, RowMapper { r,_ ->
            val id = r.uuid("requested_id")
            val member = if(r.getObject("account_id")==null) null else {
                if(r.getObject("major_name")==null || r.getObject("college_name")==null) failure("MEMBERSHIP_INTEGRITY_FAILURE","组织关系暂不可读取")
                membershipMapper.mapRow(r,0)
            }
            id to member
        },*ids.toTypedArray()).toMap()
        return ids.map { MembershipSummary(it, rows[it]) }
    }
    fun insertCollege(id: UUID, name: String,status: OrganizationStatus,now:Instant) = jdbc.update("INSERT INTO authz_college VALUES(?,?,?,1,?,?)",id,name,status.name,now.sql(),now.sql())
    fun insertMajor(id:UUID,collegeId:UUID,name:String,status:OrganizationStatus,now:Instant) = jdbc.update("INSERT INTO authz_major VALUES(?,?,?,?,1,?,?)",id,collegeId,name,status.name,now.sql(),now.sql())
    fun updateCollege(id:UUID,name:String,status:OrganizationStatus,now:Instant) = jdbc.update("UPDATE authz_college SET name=?,status=?,version=version+1,updated_at=? WHERE college_id=?",name,status.name,now.sql(),id)
    fun updateMajor(id:UUID,name:String,status:OrganizationStatus,now:Instant) = jdbc.update("UPDATE authz_major SET name=?,status=?,version=version+1,updated_at=? WHERE major_id=?",name,status.name,now.sql(),id)
    fun changeMembership(accountId:UUID,majorId:UUID,old:Membership?,actor:UUID,reason:String,now:Instant):MembershipChange {
        val version = (old?.version ?: 0L)+1
        if(old==null) jdbc.update("INSERT INTO authz_membership VALUES(?,?,1,?,?)",accountId,majorId,now.sql(),now.sql())
        else jdbc.update("UPDATE authz_membership SET major_id=?,version=?,updated_at=? WHERE account_id=?",majorId,version,now.sql(),accountId)
        val change=MembershipChange(UUID.randomUUID(),accountId,old?.majorId,majorId,actor,reason,now,version)
        jdbc.update("INSERT INTO authz_membership_change VALUES(?,?,?,?,?,?,?,?)",change.changeId,accountId,old?.majorId,majorId,actor,reason,now.sql(),version)
        return change
    }
    fun policy(id:UUID): SchoolPolicy = jdbc.query("SELECT * FROM authz_subject_policy WHERE subject_id=?",RowMapper { r,_ -> SchoolPolicy(r.uuid("subject_id"),r.getBoolean("is_public"),r.getLong("version"),r.instant("updated_at")) },id).singleOrNull() ?: failure("POLICY_NOT_READY","科目授权尚未就绪")
    fun bumpPolicy(id:UUID,now:Instant) = jdbc.update("UPDATE authz_subject_policy SET version=version+1,updated_at=? WHERE subject_id=?",now.sql(),id)
    fun has(table:String,subject:UUID,column:String,id:UUID) = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM $table WHERE subject_id=? AND $column=?)",Boolean::class.java,subject,id)!!
    fun rule(subject:UUID,account:UUID):SchoolAccountRule? = jdbc.query("SELECT * FROM authz_account_rule WHERE subject_id=? AND account_id=?",RowMapper { r,_ -> SchoolAccountRule(r.uuid("subject_id"),r.uuid("account_id"),r.getBoolean("granted"),r.getBoolean("inheritance_blocked"),r.uuid("updated_by_account_id"),r.instant("updated_at")) },subject,account).singleOrNull()
    private fun GuardMode.sqlLock() = if(this==GuardMode.UPDATE) "UPDATE" else "SHARE"
}

internal fun <T:Any> AuthorizationStore.page(
    table:String,where:String,args:List<Any>,order:String,idColumn:String,page:Int,pageSize:Int,mapper:RowMapper<T>,
):Page<T> {
    val sql="""WITH filtered AS (SELECT * FROM $table $where), total AS (SELECT count(*) total_count FROM filtered),
        sliced AS (SELECT * FROM filtered ORDER BY $order LIMIT ? OFFSET ?)
        SELECT total.total_count,sliced.* FROM total LEFT JOIN sliced ON true ORDER BY $order"""
    var total=0L
    val rows=jdbc.query(sql, RowMapper<T?> { r,n -> total=r.getLong("total_count");if(r.getObject(idColumn)==null)null else mapper.mapRow(r,n) },*(args+listOf(pageSize,(page.toLong()-1)*pageSize)).toTypedArray()).filterNotNull()
    return Page(rows,page,pageSize,total)
}
