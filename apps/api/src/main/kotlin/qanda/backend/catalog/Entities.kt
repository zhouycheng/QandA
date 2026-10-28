package qanda.backend.catalog

import com.baomidou.mybatisplus.annotation.*
import java.time.Instant
import java.util.UUID

@TableName("college")
class College {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var code: String = ""
    var name: String = ""
    var status: String = "ACTIVE"
    var version: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}

@TableName("major")
class Major {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var collegeId: UUID? = null
    var code: String = ""
    var name: String = ""
    var status: String = "ACTIVE"
    var version: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}

@TableName("subject")
class Subject {
    @TableId(type = IdType.INPUT)
    var id: UUID? = null
    var name: String = ""
    var description: String = ""
    var status: String = "ACTIVE"
    var version: Long = 1
    var createdAt: Instant = Instant.now()
    var updatedAt: Instant = Instant.now()
}
