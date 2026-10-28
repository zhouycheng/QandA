package qanda.backend.practice

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface PracticeSessionMapper: BaseMapper<PracticeSession>
@Mapper interface PracticeItemMapper: BaseMapper<PracticeItem>
@Mapper interface PracticeResultMapper: BaseMapper<PracticeResult>
