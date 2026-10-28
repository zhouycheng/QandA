package qanda.backend.platform.persistence

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor
import com.baomidou.mybatisplus.annotation.DbType
import org.apache.ibatis.type.BaseTypeHandler
import org.apache.ibatis.type.JdbcType
import org.apache.ibatis.type.MappedTypes
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.sql.CallableStatement
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.util.UUID

@Configuration
class MybatisConfiguration {
    @Bean fun mybatisInterceptor() = MybatisPlusInterceptor().apply { addInnerInterceptor(PaginationInnerInterceptor(DbType.POSTGRE_SQL)) }
}

@MappedTypes(UUID::class)
class UuidTypeHandler: BaseTypeHandler<UUID>() {
    override fun setNonNullParameter(ps: PreparedStatement, i: Int, parameter: UUID, jdbcType: JdbcType?) = ps.setObject(i,parameter)
    override fun getNullableResult(rs: ResultSet, name: String): UUID? = rs.getObject(name, UUID::class.java)
    override fun getNullableResult(rs: ResultSet, index: Int): UUID? = rs.getObject(index, UUID::class.java)
    override fun getNullableResult(cs: CallableStatement, index: Int): UUID? = cs.getObject(index) as UUID?
}
