package qanda.backend.platform.bootstrap

import org.springframework.boot.WebApplicationType
import org.springframework.boot.autoconfigure.EnableAutoConfiguration
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.annotation.ComponentScan
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.FilterType
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Controller
import qanda.backend.adminsecurity.AdminBootstrapCommand
import qanda.backend.identity.IdentitySecurity

@Configuration
@Profile("platform-bootstrap")
@EnableAutoConfiguration(exclude = [UserDetailsServiceAutoConfiguration::class])
@ComponentScan(basePackages = ["qanda.backend.platform", "qanda.backend.identity", "qanda.backend.authorization", "qanda.backend.adminsecurity"],
    excludeFilters = [ComponentScan.Filter(type = FilterType.ANNOTATION, classes = [Controller::class]),
        ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = [IdentitySecurity::class])])
class BootstrapRuntimeConfiguration

object BootstrapLauncher {
    fun run() {
        val console = System.console() ?: error("首管初始化需要本地交互终端，不接受管道凭据")
        SpringApplicationBuilder(BootstrapRuntimeConfiguration::class.java).web(WebApplicationType.NONE).profiles("platform-bootstrap")
            .run("--qanda.backend.mail.dispatch-enabled=false").use { context ->
                context.getBean(AdminBootstrapCommand::class.java).runInteractive(console)
            }
    }
}
