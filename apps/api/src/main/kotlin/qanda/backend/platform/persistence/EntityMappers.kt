package qanda.backend.platform.persistence

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface CommandReceiptMapper: BaseMapper<CommandReceipt>
@Mapper interface AuditLogMapper: BaseMapper<AuditLog>
