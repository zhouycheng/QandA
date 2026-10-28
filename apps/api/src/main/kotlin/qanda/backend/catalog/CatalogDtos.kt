package qanda.backend.catalog

import io.swagger.v3.oas.annotations.media.Schema
import java.util.UUID

data class CollegeInput(val name: String,val code: String,@field:Schema(allowableValues=["ACTIVE","INACTIVE"]) val status: String="ACTIVE",val expectedVersion: Long?=null)
data class MajorInput(val collegeId: UUID,val name: String,val code: String,@field:Schema(allowableValues=["ACTIVE","INACTIVE"]) val status: String="ACTIVE",val expectedVersion: Long?=null)
data class SubjectInput(val name: String,val description: String="",@field:Schema(allowableValues=["ACTIVE","INACTIVE"]) val status: String="ACTIVE",val expectedVersion: Long?=null)
data class CollegeView(val id: UUID,val name: String,val code: String,val status: String,val version: Long)
data class MajorView(val id: UUID,val collegeId: UUID,val name: String,val code: String,val status: String,val version: Long)
data class SubjectView(val id: UUID,val name: String,val description: String,val status: String,val version: Long)
