package qanda.backend.catalog

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface CollegeMapper: BaseMapper<College>
@Mapper interface MajorMapper: BaseMapper<Major>
@Mapper interface SubjectMapper: BaseMapper<Subject>
