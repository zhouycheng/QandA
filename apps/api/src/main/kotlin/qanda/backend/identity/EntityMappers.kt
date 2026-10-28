package qanda.backend.identity

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface UserAccountMapper: BaseMapper<UserAccount>
@Mapper interface UserProfileMapper: BaseMapper<UserProfile>
@Mapper interface UserWechatMapper: BaseMapper<UserWechat>
@Mapper interface UserSessionMapper: BaseMapper<UserSession>
@Mapper interface EmailChallengeMapper: BaseMapper<EmailChallenge>
@Mapper interface WechatTicketMapper: BaseMapper<WechatTicket>
