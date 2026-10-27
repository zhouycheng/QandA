package qanda.backend.authorization

import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.TransientDataAccessException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.RowMapper
import org.springframework.jdbc.datasource.DataSourceUtils
import org.springframework.stereotype.Service
import qanda.backend.authorization.api.*
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.transaction.JdbcTransactions
import java.text.Normalizer
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@Service
class AuthorizationService(
    private val store:AuthorizationStore, private val tx:JdbcTransactions, private val commands:AuthorizationCommands,
    private val clock:Clock, private val identities:ObjectProvider<AuthorizationIdentityPort>,
    private val administrators:ObjectProvider<AuthorizationAdminPort>, private val contents:ObjectProvider<AuthorizationContentPort>,
    private val contentReadiness:AuthorizationContentReadiness,
): MembershipOperations {
    private fun identity()=identities.ifAvailable ?: failure("IDENTITY_NOT_READY","身份服务尚未就绪")
    private fun administration()=administrators.ifAvailable ?: failure("ADMINISTRATION_NOT_READY","管理资格服务尚未就绪")
    private fun content():AuthorizationContentPort {
        contentReadiness.requireReadyInTransaction()
        return contents.ifAvailable ?: failure("CONTENT_INTEGRATION_NOT_READY","内容服务尚未就绪")
    }
    private fun now()=clock.instant().truncatedTo(ChronoUnit.MILLIS)
    private fun validatePage(page:Int,size:Int) { if(page<1 || size !in 1..100) invalid("分页参数不符合要求") }
    private fun invalid(message:String):Nothing=throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST",message)
    private fun invalidBusiness(code:String,message:String):Nothing=throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY,code,message)
    private fun name(input:String):String {
        val result=Normalizer.normalize(input.trim(),Normalizer.Form.NFC)
        if(result.codePointCount(0,result.length) !in 1..80 || result.any { it.code<32 || it.code==127 })invalidBusiness("VALIDATION_FAILED","组织名称须为1至80个有效字符")
        return result
    }
    private fun version(expected:Long?,actual:Long?) {
        if(expected!=actual)throw ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","内容已变化，请重新读取",details=actual?.let { ErrorDetails(currentVersion=it) })
        if(actual!=null && actual !in 1..MAX_VERSION)failure("VERSION_LIMIT","资源版本暂不可编辑")
    }
    private fun nextVersion(value:Long):Long { if(value>=MAX_VERSION)failure("VERSION_LIMIT","资源版本暂不可编辑");return value+1 }
    private fun requireSelectable(college:College,major:Major) {
        if(major.collegeId!=college.collegeId)invalidBusiness("MAJOR_COLLEGE_MISMATCH","专业不属于所选学院")
        if(college.status!=OrganizationStatus.ACTIVE || major.status!=OrganizationStatus.ACTIVE)invalidBusiness("ORGANIZATION_UNAVAILABLE","所选组织已停用")
    }
    private fun <T:Any> root(block:()->T):T {
        repeat(3) { attempt ->
            try { return tx.required { store.jdbc.execute("SET LOCAL lock_timeout='3s'");block() } }
            catch(e:TransientDataAccessException) { if(attempt==2)failure("TEMPORARILY_UNAVAILABLE","操作繁忙，请保留原请求后重试") }
            catch(e:DataIntegrityViolationException) {
                if(generateSequence<Throwable>(e){it.cause}.any { it.message?.contains("_name_unique")==true })throw ApiException(HttpStatus.CONFLICT,"NAME_CONFLICT","组织名称已存在")
                throw e
            }
            catch(e:ApiException) { if(e.code=="ACCOUNT_NOT_FOUND")missing();throw e }
        }
        error("Unreachable retry")
    }
    private data class Context(val actor:AuthorizationActor,val accounts:AuthorizationAccountGuards,val admin:AuthorizationAdminContext?)
    private fun context(admin:Boolean,targets:Map<UUID,GuardMode> = emptyMap()):Context {
        val actor=identity().currentActor()
        val modes=targets.toMutableMap().apply { putIfAbsent(actor.accountId,GuardMode.SHARE) }
        val guards=identity().lockAccountsAndSessionInTransaction(actor,modes)
        guards.assertHeld(actor.accountId)
        if(!guards.isActive(actor.accountId))throw ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请重新登录")
        val proof=if(admin)administration().requireAdminInTransaction(actor,guards).also { it.assertCurrentTransaction();check(it.actorAccountId==actor.accountId) } else null
        return Context(actor,guards,proof)
    }
    private fun execute(ctx:Context,operation:String,command:AuthorizationCommand,httpStatus:Int=200,block:(Instant)->Mutation):ChangeReceipt {
        val time=now()
        val (receipt,audit)=commands.execute(ctx.actor,operation,command,time,httpStatus) { block(time) }
        if(audit!=null)administration().appendAuditInTransaction(listOf(audit),command.requestId,time)
        return receipt
    }
    fun listColleges(page:Int,size:Int,admin:Boolean=false):Page<College> = root {
        validatePage(page,size);if(admin)context(true)
        store.page("authz_college",if(admin)"" else "WHERE status='ACTIVE'",emptyList(),"name,college_id","college_id",page,size,store.collegeMapper)
    }
    fun listMajors(collegeId:UUID,page:Int,size:Int,admin:Boolean=false):Page<Major> = root {
        validatePage(page,size);if(admin)context(true)
        if(!admin)store.lockOrganizations(mapOf(collegeId to GuardMode.SHARE),emptyMap())
        val college=store.college(collegeId)
        if(!admin && college.status!=OrganizationStatus.ACTIVE)missing()
        store.page("authz_major","WHERE college_id=?"+if(admin)"" else " AND status='ACTIVE'",listOf(collegeId),"name,major_id","major_id",page,size,store.majorMapper)
    }
    fun getCollege(id:UUID):College=root { context(true);store.college(id) }
    fun getMajor(id:UUID):Major=root { context(true);store.major(id) }
    fun createCollege(body:CreateOrganization,command:AuthorizationCommand):ChangeReceipt=root {
        val ctx=context(true)
        execute(ctx,"CREATE_COLLEGE",command,201) { time ->
            val id=UUID.randomUUID();store.insertCollege(id,name(body.name),body.status,time);Mutation(id,1,true,"COLLEGE")
        }
    }
    fun updateCollege(id:UUID,body:UpdateOrganization,command:AuthorizationCommand):ChangeReceipt=root {
        val ctx=context(true);store.lockOrganizations(mapOf(id to GuardMode.UPDATE),emptyMap())
        execute(ctx,"UPDATE_COLLEGE",command) { time ->
            val old=store.college(id);version(body.expectedVersion,old.version);val name=name(body.name)
            val changed=old.name!=name || old.status!=body.status
            if(changed) { nextVersion(old.version);store.updateCollege(id,name,body.status,time) }
            Mutation(id,old.version+if(changed)1 else 0,changed,"COLLEGE")
        }
    }
    fun createMajor(collegeId:UUID,body:CreateOrganization,command:AuthorizationCommand):ChangeReceipt=root {
        val ctx=context(true);store.lockOrganizations(mapOf(collegeId to GuardMode.SHARE),emptyMap())
        execute(ctx,"CREATE_MAJOR",command,201) { time ->
            if(store.college(collegeId).status!=OrganizationStatus.ACTIVE)invalidBusiness("ORGANIZATION_UNAVAILABLE","所选学院已停用")
            val id=UUID.randomUUID();store.insertMajor(id,collegeId,name(body.name),body.status,time);Mutation(id,1,true,"MAJOR")
        }
    }
    fun updateMajor(id:UUID,body:UpdateOrganization,command:AuthorizationCommand):ChangeReceipt=root {
        val ctx=context(true);val discovered=store.major(id)
        store.lockOrganizations(mapOf(discovered.collegeId to GuardMode.SHARE),mapOf(id to GuardMode.UPDATE))
        execute(ctx,"UPDATE_MAJOR",command) { time ->
            val old=store.major(id);version(body.expectedVersion,old.version);val name=name(body.name)
            if(old.status!=OrganizationStatus.ACTIVE && body.status==OrganizationStatus.ACTIVE && store.college(old.collegeId).status!=OrganizationStatus.ACTIVE)invalidBusiness("ORGANIZATION_UNAVAILABLE","所属学院已停用")
            val changed=old.name!=name || old.status!=body.status
            if(changed) { nextVersion(old.version);store.updateMajor(id,name,body.status,time) }
            Mutation(id,old.version+if(changed)1 else 0,changed,"MAJOR")
        }
    }
    override fun prepareMembershipSelectionInTransaction(collegeId:UUID,majorId:UUID,identityGuard:RegistrationIdentityProof):SelectionGuard=tx.mandatory {
        identityGuard.assertCurrentTransaction()
        store.lockOrganizations(mapOf(collegeId to GuardMode.SHARE),mapOf(majorId to GuardMode.SHARE))
        val college=store.college(collegeId);val major=store.major(majorId);requireSelectable(college,major)
        SelectionGuard(identityGuard.accountId,college,major,store.connection())
    }
    override fun initializeMembershipInTransaction(accountId:UUID,collegeId:UUID,majorId:UUID,actorAccountId:UUID,selectionGuard:SelectionGuard,now:Instant):MembershipInitialization=tx.mandatory {
        store.assertConnection(selectionGuard.transactionConnection)
        check(selectionGuard.accountId==accountId && actorAccountId==accountId && selectionGuard.college.collegeId==collegeId && selectionGuard.major.majorId==majorId) { "Membership selection does not match registration" }
        if(store.membership(accountId)!=null)throw ApiException(HttpStatus.CONFLICT,"MEMBERSHIP_EXISTS","账号已有关联组织")
        val change=store.changeMembership(accountId,majorId,null,actorAccountId,"REGISTRATION",now)
        val member=store.membership(accountId) ?: failure("MEMBERSHIP_INTEGRITY_FAILURE","组织关系暂不可读取")
        MembershipInitialization(snapshot(member),1,membershipAudit(change,null,member))
    }
    override fun readMembershipSummariesInTransaction(accountIds:List<UUID>,adminContext:AuthorizationAdminContext):List<MembershipSummary> = tx.mandatory {
        adminContext.assertCurrentTransaction()
        if(accountIds.size !in 1..100 || accountIds.distinct().size!=accountIds.size)invalid("账号列表须为1至100个互异编号")
        store.membershipSummaries(accountIds)
    }
    fun getMembership(target:UUID?=null):MembershipView=root {
        val ctx=context(target!=null,target?.let { mapOf(it to GuardMode.SHARE) } ?: emptyMap())
        MembershipView(store.membership(target ?: ctx.actor.accountId))
    }
    fun setMembership(body:SetMembership,command:AuthorizationCommand,target:UUID?=null):ChangeReceipt {
        val actor=identity().currentActor();val id=target ?: actor.accountId
        return root {
            val ctx=context(target!=null,mapOf(id to GuardMode.UPDATE));check(ctx.actor==actor)
            val old=store.membership(id)
            val colleges=(listOfNotNull(old?.collegeId)+body.collegeId).distinct().associateWith { GuardMode.SHARE }
            val majors=(listOfNotNull(old?.majorId)+body.majorId).distinct().associateWith { GuardMode.SHARE }
            store.lockOrganizations(colleges,majors)
            execute(ctx,"SET_MEMBERSHIP",command) { time ->
                version(body.expectedVersion,old?.version);requireSelectable(store.college(body.collegeId),store.major(body.majorId))
                val changed=old?.majorId!=body.majorId
                if(!changed)Mutation(id,old!!.version,false,"MEMBERSHIP") else {
                    old?.let { nextVersion(it.version) }
                    val change=store.changeMembership(id,body.majorId,old,ctx.actor.accountId,if(target==null)"SELF_CHANGE" else "ADMIN_CHANGE",time)
                    val member=store.membership(id)!!
                    Mutation(id,member.version,true,"MEMBERSHIP",membershipAudit(change,old,member))
                }
            }
        }
    }
    private fun membershipAudit(change:MembershipChange,old:Membership?,new:Membership):AuthorizationAuditFact {
        val changes=mutableListOf<AuthorizationAuditChange>()
        if(old?.collegeId!=new.collegeId)changes+=AuthorizationAuditChange("COLLEGE_ID",old?.collegeId?.toString(),new.collegeId.toString())
        if(old?.majorId!=new.majorId)changes+=AuthorizationAuditChange("MAJOR_ID",old?.majorId?.toString(),new.majorId.toString())
        changes+=AuthorizationAuditChange("RESOURCE_VERSION",old?.version?.toString(),new.version.toString())
        return AuthorizationAuditFact(change.changeId,change.actorAccountId,"MEMBERSHIP_CHANGED","MEMBERSHIP",change.accountId,changes)
    }
    fun membershipHistory(account:UUID,page:Int,size:Int):Page<MembershipChange> = root {
        validatePage(page,size);context(true,mapOf(account to GuardMode.SHARE))
        store.page("authz_membership_change","WHERE account_id=?",listOf(account),"changed_at DESC,change_id","change_id",page,size,RowMapper { r,_ -> MembershipChange(r.uuid("change_id"),r.uuid("account_id"),r.getObject("from_major_id",UUID::class.java),r.uuid("to_major_id"),r.uuid("actor_account_id"),r.getString("reason"),r.instant("changed_at"),r.getLong("resulting_version")) })
    }
    fun prepareAccessInTransaction(actor:AuthorizationActor,accounts:AuthorizationAccountGuards):OrganizationGuards=tx.mandatory {
        accounts.assertHeld(actor.accountId);check(accounts.isActive(actor.accountId))
        prepareOrganizations(actor.accountId)
    }
    private fun prepareOrganizations(accountId:UUID):OrganizationGuards {
        val old=store.membership(accountId)
        if(old!=null)store.lockOrganizations(mapOf(old.collegeId to GuardMode.SHARE),mapOf(old.majorId to GuardMode.SHARE))
        return OrganizationGuards(accountId,store.membership(accountId),store.connection())
    }
    fun snapshotMembershipInTransaction(guards:OrganizationGuards):MembershipSnapshot=tx.mandatory {
        store.assertConnection(guards.transactionConnection)
        snapshot(guards.membership ?: throw ApiException(HttpStatus.CONFLICT,"MEMBERSHIP_REQUIRED","请先完善学院专业"))
    }
    private fun snapshot(m:Membership)=MembershipSnapshot(m.accountId,m.collegeId,m.collegeName,m.majorId,m.majorName)
    fun initializeSubjectPolicyInTransaction(guard:AuthorizationSubjectGuard,descriptor:SubjectAccessDescriptor,now:Instant):SchoolPolicy=tx.mandatory {
        contentReadiness.requireReadyInTransaction();guard.assertHeld(GuardMode.UPDATE);check(guard.subjectId==descriptor.id)
        validateDescriptor(descriptor)
        store.jdbc.update("INSERT INTO authz_subject_policy VALUES(?,false,1,?,?)",descriptor.id,now.sql(),now.sql())
        store.policy(descriptor.id)
    }
    private fun validateDescriptor(d:SubjectAccessDescriptor) {
        check(d.status in setOf("ACTIVE","INACTIVE") && (d.source==SubjectSource.USER)==(d.ownerAccountId!=null) && d.contentVersion in 1..MAX_VERSION) { "Invalid content descriptor" }
    }
    private data class Bits(val policy:SchoolPolicy,val public:Boolean,val college:Boolean,val major:Boolean,val granted:Boolean,val blocked:Boolean,val shared:Boolean)
    private fun bits(ids:List<UUID>,account:UUID,member:Membership?):Map<UUID,Bits> {
        if(ids.isEmpty())return emptyMap()
        val sql="""SELECT ap.*,COALESCE(r.granted,false) explicit_granted,COALESCE(r.inheritance_blocked,false) blocked,
            EXISTS(SELECT 1 FROM authz_college_grant cg WHERE cg.subject_id=ap.subject_id AND cg.college_id=?) college_granted,
            EXISTS(SELECT 1 FROM authz_major_grant mg WHERE mg.subject_id=ap.subject_id AND mg.major_id=?) major_granted,
            EXISTS(SELECT 1 FROM authz_user_share sh WHERE sh.subject_id=ap.subject_id AND sh.recipient_account_id=?) shared
            FROM authz_subject_policy ap LEFT JOIN authz_account_rule r ON r.subject_id=ap.subject_id AND r.account_id=?
            WHERE ap.subject_id IN (${ids.joinToString(","){"?"}})"""
        val args=listOf(member?.collegeId,member?.majorId,account,account)+ids
        return store.jdbc.query(sql,RowMapper { r,_ -> val p=SchoolPolicy(r.uuid("subject_id"),r.getBoolean("is_public"),r.getLong("version"),r.instant("updated_at"));p.subjectId to Bits(p,p.isPublic,r.getBoolean("college_granted"),r.getBoolean("major_granted"),r.getBoolean("explicit_granted"),r.getBoolean("blocked"),r.getBoolean("shared")) },*args.toTypedArray()).toMap()
    }
    fun evaluateLocked(actor:AuthorizationActor,accounts:AuthorizationAccountGuards,organizations:OrganizationGuards,guard:AuthorizationSubjectGuard,descriptor:SubjectAccessDescriptor,action:AccessAction,adminContext:AuthorizationAdminContext?=null):AccessVerdict=tx.mandatory {
        contentReadiness.requireReadyInTransaction();accounts.assertHeld(actor.accountId);check(accounts.isActive(actor.accountId));store.assertConnection(organizations.transactionConnection)
        check(organizations.accountId==actor.accountId);guard.assertHeld();check(guard.subjectId==descriptor.id);validateDescriptor(descriptor)
        adminContext?.let { it.assertCurrentTransaction();check(it.actorAccountId==actor.accountId) }
        val b=bits(listOf(descriptor.id),actor.accountId,organizations.membership)[descriptor.id] ?: failure("POLICY_NOT_READY","科目授权尚未就绪")
        AuthorizationPolicy.evaluate(descriptor,action,b.policy.version,AccessFacts(organizations.membership!=null,organizations.membership?.organizationActive==true,b.public,b.college,b.major,b.granted,b.blocked,descriptor.ownerAccountId==actor.accountId,b.shared,adminContext!=null))
    }
    fun authorizedScopeForQuery(actor:AuthorizationActor,accounts:AuthorizationAccountGuards,organizations:OrganizationGuards,action:AccessAction,adminContext:AuthorizationAdminContext?=null):AuthorizedSubjectScope=tx.mandatory {
        contentReadiness.requireReadyInTransaction();accounts.assertHeld(actor.accountId);check(accounts.isActive(actor.accountId));store.assertConnection(organizations.transactionConnection);check(organizations.accountId==actor.accountId)
        adminContext?.let { it.assertCurrentTransaction();check(it.actorAccountId==actor.accountId) }
        AuthorizationPolicy.scope(actor.accountId,organizations.membership,action,adminContext!=null)
    }
    private data class SubjectContext(val context:Context,val content:AuthorizationContentPort,val guard:AuthorizationSubjectGuard,val descriptor:SubjectAccessDescriptor)
    private fun subjectContext(subject:UUID,admin:Boolean,update:Boolean,targets:Map<UUID,GuardMode> = emptyMap(),beforeSubject:(Context)->Unit = {}):SubjectContext {
        val ctx=context(admin,targets);beforeSubject(ctx)
        val content=content();val guard=content.lockSubjectInTransaction(subject,if(update)GuardMode.UPDATE else GuardMode.SHARE)
        guard.assertHeld(if(update)GuardMode.UPDATE else GuardMode.SHARE)
        val d=content.describeLocked(guard);validateDescriptor(d);check(d.id==subject)
        if(admin) { if(d.source!=SubjectSource.SCHOOL)invalidBusiness("SCHOOL_SUBJECT_REQUIRED","该操作仅适用于学校科目") }
        else { if(d.source!=SubjectSource.USER)invalidBusiness("USER_SUBJECT_REQUIRED","该操作仅适用于个人科目");if(d.ownerAccountId!=ctx.actor.accountId || !d.ownerManagementAvailable)missing() }
        return SubjectContext(ctx,content,guard,d)
    }
    fun getSchoolPolicy(subject:UUID):SchoolPolicy=root { subjectContext(subject,true,false);store.policy(subject) }
    fun setSchoolPublic(subject:UUID,body:SetPublic,command:AuthorizationCommand):ChangeReceipt=root {
        val s=subjectContext(subject,true,true)
        execute(s.context,"SET_PUBLIC",command) { time ->
            val old=store.policy(subject);version(body.expectedVersion,old.version)
            val changed=old.isPublic!=body.isPublic
            if(changed) { nextVersion(old.version);store.jdbc.update("UPDATE authz_subject_policy SET is_public=? WHERE subject_id=?",body.isPublic,subject);store.bumpPolicy(subject,time) }
            val audit=if(changed)AuthorizationAuditFact(UUID.randomUUID(),s.context.actor.accountId,"SCHOOL_ACCESS_CHANGED","SUBJECT",subject,listOf(AuthorizationAuditChange("RESOURCE_VERSION",old.version.toString(),(old.version+1).toString()),AuthorizationAuditChange("IS_PUBLIC",old.isPublic.toString(),body.isPublic.toString()))) else null
            Mutation(subject,old.version+if(changed)1 else 0,changed,"SUBJECT",audit)
        }
    }
    fun setOrganizationGrant(subject:UUID,organization:UUID,college:Boolean,body:SetOrganizationGrant,command:AuthorizationCommand):ChangeReceipt=root {
        var parent=organization
        val s=subjectContext(subject,true,true,beforeSubject={
            parent=if(college)organization else store.major(organization).collegeId
            store.lockOrganizations(mapOf(parent to if(college)GuardMode.UPDATE else GuardMode.SHARE),if(college)emptyMap() else mapOf(organization to GuardMode.UPDATE))
        })
        val table=if(college)"authz_college_grant" else "authz_major_grant";val key=if(college)"college_id" else "major_id"
        execute(s.context,if(college)"SET_COLLEGE_GRANT" else "SET_MAJOR_GRANT",command) { time ->
            val policy=store.policy(subject);version(body.expectedVersion,policy.version)
            if(body.enabled && (store.college(parent).status!=OrganizationStatus.ACTIVE || (!college && store.major(organization).status!=OrganizationStatus.ACTIVE)))invalidBusiness("ORGANIZATION_UNAVAILABLE","所选组织已停用")
            val old=store.has(table,subject,key,organization);val changed=old!=body.enabled
            if(changed) {
                nextVersion(policy.version)
                if(body.enabled)store.jdbc.update("INSERT INTO $table VALUES(?,?,?,?)",subject,organization,s.context.actor.accountId,time.sql())
                else store.jdbc.update("DELETE FROM $table WHERE subject_id=? AND $key=?",subject,organization)
                store.bumpPolicy(subject,time)
            }
            Mutation(subject,policy.version+if(changed)1 else 0,changed,"SUBJECT")
        }
    }
    fun setAccountRule(subject:UUID,account:UUID,body:SetSchoolAccountRule,command:AuthorizationCommand):ChangeReceipt=root {
        val s=subjectContext(subject,true,true,mapOf(account to GuardMode.SHARE))
        execute(s.context,"SET_ACCOUNT_RULE",command) { time ->
            val policy=store.policy(subject);version(body.expectedVersion,policy.version);val old=store.rule(subject,account)
            val changed=(old?.granted ?: false)!=body.granted || (old?.inheritanceBlocked ?: false)!=body.inheritanceBlocked
            if(changed) {
                nextVersion(policy.version)
                if(!body.granted && !body.inheritanceBlocked)store.jdbc.update("DELETE FROM authz_account_rule WHERE subject_id=? AND account_id=?",subject,account)
                else store.jdbc.update("""INSERT INTO authz_account_rule VALUES(?,?,?,?,?,?) ON CONFLICT(subject_id,account_id)
                    DO UPDATE SET granted=EXCLUDED.granted,inheritance_blocked=EXCLUDED.inheritance_blocked,updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=EXCLUDED.updated_at""",subject,account,body.granted,body.inheritanceBlocked,s.context.actor.accountId,time.sql())
                store.bumpPolicy(subject,time)
            }
            Mutation(subject,policy.version+if(changed)1 else 0,changed,"SUBJECT")
        }
    }
    fun listCollegeGrants(subject:UUID,page:Int,size:Int):PolicyPage<CollegeGrant> = root {
        validatePage(page,size);subjectContext(subject,true,false)
        val p=store.page("authz_college_grant","WHERE subject_id=?",listOf(subject),"college_id","college_id",page,size,RowMapper { r,_ -> CollegeGrant(r.uuid("subject_id"),r.uuid("college_id"),r.uuid("granted_by_account_id"),r.instant("granted_at")) });policyPage(p,store.policy(subject).version)
    }
    fun listMajorGrants(subject:UUID,page:Int,size:Int):PolicyPage<MajorGrant> = root {
        validatePage(page,size);subjectContext(subject,true,false)
        val p=store.page("authz_major_grant","WHERE subject_id=?",listOf(subject),"major_id","major_id",page,size,RowMapper { r,_ -> MajorGrant(r.uuid("subject_id"),r.uuid("major_id"),r.uuid("granted_by_account_id"),r.instant("granted_at")) });policyPage(p,store.policy(subject).version)
    }
    fun listAccountRules(subject:UUID,page:Int,size:Int):PolicyPage<SchoolAccountRule> = root {
        validatePage(page,size);subjectContext(subject,true,false)
        val p=store.page("authz_account_rule","WHERE subject_id=?",listOf(subject),"account_id","account_id",page,size,RowMapper { r,_ -> SchoolAccountRule(r.uuid("subject_id"),r.uuid("account_id"),r.getBoolean("granted"),r.getBoolean("inheritance_blocked"),r.uuid("updated_by_account_id"),r.instant("updated_at")) });policyPage(p,store.policy(subject).version)
    }
    private fun <T> policyPage(page:Page<T>,version:Long)=PolicyPage(page.items,page.page,page.pageSize,page.totalItems,version)
    fun listShares(subject:UUID,page:Int,size:Int):PolicyPage<UserSubjectShare> = root {
        validatePage(page,size);val s=subjectContext(subject,false,false)
        val shares=store.page("authz_user_share","WHERE subject_id=?",listOf(subject),"recipient_account_id","recipient_account_id",page,size,RowMapper { r,_ -> r.uuid("recipient_account_id") to r.instant("granted_at") })
        val ids=shares.items.map { it.first }
        val token=store.connection()
        val labels=if(ids.isEmpty())emptyMap() else identity().readRecipientSummariesForOwnedShares(ids,OwnedShareReadProof(s.context.actor.accountId,subject,ids,store.connection()) { store.assertConnection(token);DataSourceUtils.getConnection(requireNotNull(store.jdbc.dataSource)) }).associateBy { it.accountId }
        if(labels.keys!=ids.toSet())failure("SHARE_INTEGRITY_FAILURE","分享关系暂不可读取")
        PolicyPage(shares.items.map { (id,time) -> val r=labels.getValue(id);UserSubjectShare(subject,id,r.accountCode,r.nickname,time) },page,size,shares.totalItems,store.policy(subject).version)
    }
    fun validateOwnedShareReadProofInTransaction(proof:OwnedShareReadProof,ids:List<UUID>) = tx.mandatory {
        store.assertConnection(proof.transactionToken)
        check(ids.size in 1..100 && ids.distinct().size==ids.size && proof.recipientAccountIds.toSet().containsAll(ids)) { "Invalid recipient projection scope" }
        check(ids.all { store.has("authz_user_share",proof.subjectId,"recipient_account_id",it) }) { "Recipient is not referenced by this share scope" }
    }
    fun grantShare(subject:UUID,body:GrantUserShare,command:AuthorizationCommand):ChangeReceipt {
        val actor=identity().currentActor()
        // A replay rechecks the owner; a later recipient disable must not prevent its minimal receipt.
        if(commands.hasReceipt(actor,"GRANT_SHARE",command.commandId))return root {
            val s=subjectContext(subject,false,true);check(s.context.actor==actor)
            execute(s.context,"GRANT_SHARE",command) { failure("IDEMPOTENCY_RECEIPT_UNAVAILABLE","原请求回执暂不可读取") }
        }
        val recipient=identity().resolveRecipient(body.accountCode)
        return shareMutation(subject,recipient.accountId,body.expectedVersion,true,command)
    }
    fun revokeShare(subject:UUID,body:RevokeUserShare,command:AuthorizationCommand)=shareMutation(subject,body.recipientAccountId,body.expectedVersion,false,command)
    private fun shareMutation(subject:UUID,recipient:UUID,expected:Long,enabled:Boolean,command:AuthorizationCommand):ChangeReceipt=root {
        val s=subjectContext(subject,false,true,mapOf(recipient to GuardMode.SHARE))
        if(recipient==s.context.actor.accountId)invalidBusiness("SELF_SHARE","无需向自己分享科目")
        execute(s.context,if(enabled)"GRANT_SHARE" else "REVOKE_SHARE",command) { time ->
            if(enabled && !s.context.accounts.isActive(recipient))missing()
            val policy=store.policy(subject);version(expected,policy.version)
            val old=store.has("authz_user_share",subject,"recipient_account_id",recipient);val changed=old!=enabled
            if(changed) {
                nextVersion(policy.version)
                if(enabled)store.jdbc.update("INSERT INTO authz_user_share VALUES(?,?,?,?)",subject,recipient,s.context.actor.accountId,time.sql())
                else store.jdbc.update("DELETE FROM authz_user_share WHERE subject_id=? AND recipient_account_id=?",subject,recipient)
                store.bumpPolicy(subject,time)
            }
            Mutation(subject,policy.version+if(changed)1 else 0,changed,"SUBJECT")
        }
    }
    fun explainSchoolAccess(account:UUID,page:Int,size:Int):Page<SchoolAccessExplanation> = root {
        validatePage(page,size);val ctx=context(true,mapOf(account to GuardMode.SHARE));val org=prepareOrganizations(account)
        val content=content();val metadata=content.readSchoolMetadataInTransaction(page,size)
        check(metadata.items.size<=size && metadata.items.all { it.first.source==SubjectSource.SCHOOL }) { "Content metadata scope violated" }
        val descriptors=metadata.items.sortedBy { it.first.id.toString() }.associate { (d,_) -> val guard=content.lockSubjectInTransaction(d.id,GuardMode.SHARE);guard.assertHeld();d.id to content.describeLocked(guard) }
        val rows=bits(metadata.items.map { it.first.id },account,org.membership)
        val items=metadata.items.map { (original,title) ->
            val d=descriptors.getValue(original.id);val b=rows[d.id] ?: failure("POLICY_NOT_READY","科目授权尚未就绪")
            val verdict=AuthorizationPolicy.evaluate(d,AccessAction.READ_LEARNING_HISTORY,b.policy.version,AccessFacts(org.membership!=null,org.membership?.organizationActive==true,b.public,b.college,b.major,b.granted,b.blocked))
            SchoolAccessExplanation(d.id,title,ctx.accounts.isActive(account) && verdict.accessGranted,ctx.accounts.isActive(account),org.membership!=null,org.membership?.organizationActive==true,b.public,b.college,b.major,b.granted,b.blocked,b.policy.version,d.newSelectionAvailable,d.issuedVersionReadAvailable)
        }
        Page(items,page,size,metadata.totalItems)
    }
}
