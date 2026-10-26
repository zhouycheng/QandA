package qanda.backend

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
import org.springframework.boot.runApplication

@SpringBootApplication(exclude = [UserDetailsServiceAutoConfiguration::class])
class Application

fun main(args: Array<String>) {
    if (args.firstOrNull() == "bootstrap") {
        require(args.size == 1) { "首管命令不接受凭据参数" }
        qanda.backend.platform.bootstrap.BootstrapLauncher.run()
    } else runApplication<Application>(*args)
}
