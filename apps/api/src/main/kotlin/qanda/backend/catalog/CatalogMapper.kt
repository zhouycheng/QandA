package qanda.backend.catalog

import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param
import java.util.UUID

@Mapper interface CatalogQueries {
    fun lockCollege(@Param("id") id: UUID): College?
    fun lockMajor(@Param("id") id: UUID): Major?
    fun lockSubject(@Param("id") id: UUID): Subject?
    fun subjects(@Param("keyword") keyword: String?,@Param("publicOnly") publicOnly: Boolean,@Param("offset") offset: Int,@Param("limit") limit: Int): List<Subject>
    fun subjectCount(@Param("keyword") keyword: String?,@Param("publicOnly") publicOnly: Boolean): Long
    fun publishedSubject(@Param("id") id: UUID): Subject?
}
