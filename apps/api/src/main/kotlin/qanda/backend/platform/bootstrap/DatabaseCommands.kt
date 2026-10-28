package qanda.backend.platform.bootstrap

import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.core.io.ClassPathResource
import qanda.backend.Application
import qanda.backend.admin.AdminService
import javax.sql.DataSource

object DatabaseCommands {
    fun run(command: String) {
        SpringApplicationBuilder(Application::class.java).web(WebApplicationType.NONE).run("--qanda.backend.mail.dispatch-enabled=false","--springdoc.api-docs.enabled=false","--springdoc.swagger-ui.enabled=false","--qanda.backend.schema-command=${command!="bootstrap"}").use { context ->
            val environment=context.environment
            if(command=="bootstrap") {
                val console=System.console() ?: error("请在可交互终端运行首管命令")
                val username=console.readLine("管理员用户名：") ?: error("输入已取消")
                val name=console.readLine("管理员姓名：") ?: error("输入已取消")
                val chars=console.readPassword("管理员密码：") ?: error("输入已取消")
                try { context.getBean(AdminService::class.java).bootstrap(username,name,String(chars));console.printf("首个管理员已创建。%n") } finally { chars.fill('\u0000') }
            } else {
                val mode=environment.getProperty("qanda.backend.mode","production")
                require(mode in setOf("local","test")) { "初始化命令仅允许local/test环境" }
                val url=environment.getRequiredProperty("spring.datasource.url")
                require(url.matches(Regex("jdbc:postgresql://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):[0-9]+/qanda_backend(?:\\?.*)?"))) { "初始化仅允许本机专用开发数据库" }
                initialize(context.getBean(DataSource::class.java),command=="db-reset")
                println("开发数据库初始化完成。")
            }
        }
    }
    fun initialize(source: DataSource,reset: Boolean=false) {
        source.connection.use { connection ->
            require(connection.catalog=="qanda_backend") { "须使用独立的qanda_backend数据库" }
            connection.autoCommit=false
            try {
                connection.createStatement().use { statement ->
                    if(reset) statement.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
                    else statement.executeQuery("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").use { result -> result.next();require(result.getInt(1)==0) { "数据库包含现有表，请显式使用db-reset重建开发库" } }
                    statement.execute(ClassPathResource("db/schema.sql").getContentAsString(Charsets.UTF_8))
                }
                connection.commit()
            } catch(error: Exception) { connection.rollback();throw error }
        }
    }
}
