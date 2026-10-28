package qanda.backend

import org.mybatis.spring.annotation.MapperScan
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication(exclude = [UserDetailsServiceAutoConfiguration::class])
@MapperScan(basePackages = ["qanda.backend"], annotationClass = org.apache.ibatis.annotations.Mapper::class)
@EnableScheduling
class Application

fun main(args: Array<String>) {
    if (args.firstOrNull() in setOf("bootstrap", "db-init", "db-reset")) {
        qanda.backend.platform.bootstrap.DatabaseCommands.run(args.single())
    } else runApplication<Application>(*args)
}
