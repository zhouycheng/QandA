package qanda.backend.platform.files

import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.jdbc.core.JdbcTemplate
import qanda.backend.platform.transaction.JdbcTransactions
import java.nio.file.Path
import java.time.Clock

@Configuration
@ConditionalOnProperty(name = ["qanda.backend.files.enabled"], havingValue = "true")
class FileRuntimeConfiguration {
    @Bean fun binaryAssets(jdbc: JdbcTemplate, tx: JdbcTransactions, clock: Clock, environment: Environment, policies: ObjectProvider<AssetReadPolicy>): BinaryAssetPort =
        JdbcBinaryAssets(jdbc, tx, clock, Path.of(environment.getRequiredProperty("qanda.backend.files.root"))) { policies.orderedStream().toList() }
}
