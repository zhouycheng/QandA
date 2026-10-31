package qanda.backend.identity

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.catalog.*
import qanda.backend.identity.api.WechatCodeExchange
import qanda.backend.platform.http.MutationResult
import qanda.backend.platform.http.requireVersion
import qanda.backend.platform.http.missing
import qanda.backend.platform.persistence.SystemMapper
import qanda.backend.platform.security.Actor
import qanda.backend.platform.security.LoginAttempts
import java.time.Clock
import java.util.UUID

@Service
@Transactional
class IdentityService(private val users: UserAccountMapper,private val profiles: UserProfileMapper,private val bindings: UserWechatMapper,
                      private val sessionRows: UserSessionMapper,private val tickets: WechatTicketMapper,private val challengeRows: EmailChallengeMapper,private val sql: IdentityMapper,
                      private val crypto: IdentityCrypto,private val challenges: ChallengeService,private val wechat: WechatCodeExchange,
                      private val colleges: CollegeMapper,private val majors: MajorMapper,private val attempts: LoginAttempts,
                      private val system: SystemMapper,private val clock: Clock) {
    fun view(id: UUID): UserView {
        val user=users.selectById(id) ?: missing();val profile=profiles.selectById(id)
        val college=profile?.majorId?.let { majors.selectById(it)?.collegeId } ?: profile?.collegeId
        return UserView(id,user.accountCode,user.nickname,user.email,bindings.selectCount(QueryWrapper<UserWechat>().eq("user_id",id))>0,
            college,profile?.majorId,profile?.enrollmentYear,user.status,user.version,user.createdAt,college?.let { colleges.selectById(it)?.name },profile?.majorId?.let { majors.selectById(it)?.name })
    }
    fun register(input: RegistrationInput): MutationResult {
        val password=crypto.preparePassword(input.password);val display=nickname(input.nickname)
        val proof=challenges.consume(input.challengeId,"REGISTER",null)
        if(sql.userByEmail(proof.emailKey)!=null) conflict("EMAIL_UNAVAILABLE","该邮箱暂不可注册")
        val user=newUser(display).apply { email=proof.email;emailKey=proof.emailKey;passwordHash=password.encoded }
        users.insert(user);profiles.insert(UserProfile().apply { userId=user.id })
        return MutationResult(user.id!!,user.version)
    }
    fun login(input: LoginInput): TokenView {
        val address=email(input.email);if(input.clientType !in setOf("WEB","MINI_PROGRAM")) invalid("clientType")
        val scope="student:${address.key}";if(attempts.blocked(scope)) unauthenticated()
        val user=sql.userByEmail(address.key)
        if(!crypto.verifyPassword(input.password,user?.passwordHash) || user?.status!="ACTIVE") {
            attempts.failure(scope,5,30,true);unauthenticated()
        }
        attempts.clear(scope)
        return issueSession(user!!,input.deviceId,input.clientType)
    }
    fun wechatLogin(input: WechatLoginInput): WechatLoginView {
        val identity=wechat.exchange(input.code);val binding=sql.wechat(identity.appId,identity.openId)
        if(binding!=null) {
            val user=users.selectById(binding.userId) ?: unauthenticated();if(user.status!="ACTIVE") unauthenticated()
            return WechatLoginView(session=issueSession(user,input.deviceId,"MINI_PROGRAM"))
        }
        val token=crypto.randomToken();tickets.insert(WechatTicket().apply { id=UUID.randomUUID();tokenDigest=crypto.tokenDigest(token)
            appId=identity.appId;openId=identity.openId;unionId=identity.unionId;expiresAt=clock.instant().plusSeconds(600) })
        return WechatLoginView(registrationToken=token)
    }
    fun registerWechat(input: WechatRegistrationInput): MutationResult {
        token(input.registrationToken);val display=nickname(input.nickname)
        val ticket=sql.lockTicket(crypto.tokenDigest(input.registrationToken)) ?: invalidProof()
        if(ticket.consumedAt!=null || !ticket.expiresAt.isAfter(clock.instant())) invalidProof()
        val user=newUser(display);users.insert(user);profiles.insert(UserProfile().apply { userId=user.id })
        bindings.insert(UserWechat().apply { id=UUID.randomUUID();userId=user.id;appId=ticket.appId;openId=ticket.openId;unionId=ticket.unionId })
        sql.consumeTicket(ticket.id!!)
        return MutationResult(user.id!!,1)
    }
    private fun newUser(display: String)=UserAccount().apply { id=UUID.randomUUID();accountCode=crypto.accountCode();nickname=display;createdAt=clock.instant();updatedAt=createdAt }
    private fun issueSession(user: UserAccount,device: UUID,client: String): TokenView {
        sql.lockUser(user.id!!)?.let { if(it.status!="ACTIVE" || it.credentialVersion!=user.credentialVersion) unauthenticated() }
        val token="u_"+crypto.randomToken();val row=UserSession().apply { id=UUID.randomUUID();userId=user.id;tokenDigest=crypto.tokenDigest(token)
            credentialVersion=user.credentialVersion;deviceId=device;clientType=client;issuedAt=clock.instant();lastSeenAt=issuedAt;expiresAt=issuedAt.plusSeconds(30*86400L) }
        sessionRows.insert(row);system.activity(user.id!!,client)
        return TokenView(token,row.id!!,row.expiresAt)
    }
    fun updateProfile(actor: Actor,input: ProfileInput): MutationResult {
        val user=sql.lockUser(actor.id) ?: unauthenticated();requireVersion(input.expectedVersion,user.version)
        val college=input.collegeId?.let { colleges.selectById(it) ?: invalid("collegeId") }
        val major=input.majorId?.let { majors.selectById(it) ?: invalid("majorId") }
        if(college?.status=="INACTIVE" || major?.status=="INACTIVE") invalid("majorId")
        if(major!=null && input.collegeId!=null && major.collegeId!=input.collegeId) invalid("majorId")
        if(major!=null && colleges.selectById(major.collegeId)?.status!="ACTIVE") invalid("majorId")
        if(input.enrollmentYear!=null && input.enrollmentYear !in 1900..2200) invalid("enrollmentYear")
        user.nickname=nickname(input.nickname);user.version++;user.updatedAt=clock.instant();users.updateById(user)
        sql.updateProfile(actor.id,if(major==null) input.collegeId else null,input.majorId,input.enrollmentYear)
        return MutationResult(actor.id,user.version)
    }
    fun reset(input: ResetPasswordInput): MutationResult {
        val hash=crypto.preparePassword(input.newPassword).encoded
        val proof=challengeRows.selectById(input.challengeId) ?: invalidProof();val userId=proof.userId ?: invalidProof()
        val user=sql.lockUser(userId) ?: invalidProof();if(user.status!="ACTIVE") invalidProof()
        challenges.consume(input.challengeId,"RESET_PASSWORD",userId)
        sql.updateCredentials(userId,user.email,user.emailKey,hash);sql.revokeUserSessions(userId)
        return MutationResult(userId,user.version+1)
    }
    fun changePassword(actor: Actor,input: PasswordInput): MutationResult {
        val user=sql.lockUser(actor.id) ?: unauthenticated();requireVersion(input.expectedVersion,user.version)
        val hash=crypto.preparePassword(input.newPassword).encoded;challenges.consume(input.challengeId,"CHANGE_PASSWORD",actor.id)
        sql.updateCredentials(actor.id,user.email,user.emailKey,hash);sql.revokeUserSessions(actor.id)
        return MutationResult(actor.id,user.version+1)
    }
    fun changeEmail(actor: Actor,input: EmailInput): MutationResult {
        val user=sql.lockUser(actor.id) ?: unauthenticated();requireVersion(input.expectedVersion,user.version)
        if(user.email!=null) challenges.consume(input.oldChallengeId ?: invalid("oldChallengeId"),"CHANGE_EMAIL_OLD",actor.id)
        val proof=challenges.consume(input.newChallengeId,if(user.email==null) "BIND_EMAIL" else "CHANGE_EMAIL_NEW",actor.id)
        if(sql.userByEmail(proof.emailKey)!=null) conflict("EMAIL_UNAVAILABLE","邮箱暂不可使用")
        sql.updateCredentials(actor.id,proof.email,proof.emailKey,user.passwordHash);sql.revokeUserSessions(actor.id)
        return MutationResult(actor.id,user.version+1)
    }
    fun bindWechat(actor: Actor,input: WechatBindingInput): MutationResult {
        val user=sql.lockUser(actor.id) ?: unauthenticated();requireVersion(input.expectedVersion,user.version)
        val identity=wechat.exchange(input.code)
        bindings.insert(UserWechat().apply { id=UUID.randomUUID();userId=actor.id;appId=identity.appId;openId=identity.openId;unionId=identity.unionId })
        user.version++;users.updateById(user);return MutationResult(actor.id,user.version)
    }
    fun sessions(actor: Actor): List<SessionView> = sessionRows.selectList(QueryWrapper<UserSession>().eq("user_id",actor.id).isNull("revoked_at").gt("expires_at",clock.instant()).orderByDesc("issued_at"))
        .map { SessionView(it.id!!,it.deviceId!!,it.clientType,it.issuedAt,it.expiresAt,it.id==actor.sessionId) }
    fun revoke(actor: Actor,id: UUID): MutationResult {
        val row=sql.lockUserSession(id) ?: missing();if(row.userId!=actor.id) missing()
        row.revokedAt=clock.instant();sessionRows.updateById(row);return MutationResult(id,1)
    }
}
