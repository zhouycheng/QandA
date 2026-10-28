package qanda.backend.content

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface QuestionBankMapper: BaseMapper<QuestionBank>
@Mapper interface ChapterMapper: BaseMapper<Chapter>
@Mapper interface QuestionMapper: BaseMapper<Question>
@Mapper interface QuestionRevisionMapper: BaseMapper<QuestionRevision>
@Mapper interface BankAudienceMapper: BaseMapper<BankAudience>
