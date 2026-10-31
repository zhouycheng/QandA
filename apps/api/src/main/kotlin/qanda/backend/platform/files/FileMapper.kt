package qanda.backend.platform.files

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.util.UUID

@Mapper interface FileQueries {
    fun issuedTo(@Param("userId") userId: UUID,@Param("fileId") fileId: UUID): Boolean
    fun publiclyVisible(@Param("fileId") fileId: UUID): Boolean
}
