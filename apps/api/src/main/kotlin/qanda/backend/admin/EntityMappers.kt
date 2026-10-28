package qanda.backend.admin

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface AdminAccountMapper: BaseMapper<AdminAccount>
@Mapper interface AdminSessionMapper: BaseMapper<AdminSession>
@Mapper interface SecurityPolicyMapper: BaseMapper<SecurityPolicy>
