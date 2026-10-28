package qanda.backend.operations

import com.baomidou.mybatisplus.core.mapper.BaseMapper
import org.apache.ibatis.annotations.Mapper

@Mapper interface QuestionFeedbackMapper: BaseMapper<QuestionFeedback>
@Mapper interface CourseRequestMapper: BaseMapper<CourseRequest>
@Mapper interface AnnouncementMapper: BaseMapper<Announcement>
