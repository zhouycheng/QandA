package qanda.backend.platform.bootstrap

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.beans.factory.InitializingBean
import org.springframework.context.annotation.DependsOn
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import qanda.backend.platform.persistence.SystemMapper

@Configuration
@ConditionalOnProperty(name=["qanda.backend.schema-command"],havingValue="false",matchIfMissing=true)
class SchemaReadiness {
    @Bean @DependsOn("backendSafety","validateProductionProviders")
    fun databaseReady(sql: SystemMapper)=InitializingBean { check(sql.ready()) { "数据库结构未就绪，请按README运行db-init初始化或执行对应的保留数据升级脚本" } }
}
data class HealthView(val status: String="UP",val version: String="1.0.0")
@RestController
class HealthController {
    @GetMapping("/api/v1/health",produces=["application/json"]) fun health()=HealthView()
}
