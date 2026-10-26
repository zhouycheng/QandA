package qanda.backend.platform.config

import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.util.Base64

@Configuration
class ProviderConfigurationGuard {
    @Bean
    fun validateProductionProviders(environment: Environment) = FlywayConfigurationCustomizer {
        validate(environment)
    }

    fun validate(environment: Environment) {
        val mode = environment.getProperty("qanda.backend.mode", "production")
        val localWechat = environment.getProperty("BACKEND_WECHAT_PROVIDER", "official") == "local"
        require(!localWechat || mode in setOf("local", "test")) { "本地微信测试身份只可用于local/test" }
        if (mode != "production") return
        require(environment.getProperty("BACKEND_WECHAT_PROVIDER", "official") == "official") { "生产配置须使用官方微信提供端" }
        require(environment.getProperty("BACKEND_WECHAT_APP_ID")?.matches(Regex("wx[A-Za-z0-9]{16}")) == true && !environment.getProperty("BACKEND_WECHAT_APP_SECRET").isNullOrBlank()) { "官方微信应用凭据尚未配置" }
        val ring = try { environment.getRequiredProperty("BACKEND_IDENTITY_MAC_KEYS").split(',').associate { entry ->
            val parts = entry.split(':', limit = 2); parts[0].toInt() to Base64.getDecoder().decode(parts[1])
        } } catch (_: Exception) { error("身份MAC私有密钥尚未配置") }
        val active = environment.getProperty("BACKEND_IDENTITY_MAC_ACTIVE_VERSION", Int::class.java, 1)
        require(ring.isNotEmpty() && ring.keys.all { it in 1..32767 } && ring.values.all { it.size >= 32 } && active in ring) { "身份MAC密钥版本或长度不符合要求" }
        require(runCatching { Base64.getDecoder().decode(environment.getRequiredProperty("BACKEND_IDENTITY_RATE_KEY")).size >= 32 }.getOrDefault(false)) { "独立身份频控密钥尚未配置" }
        require(environment.getProperty("qanda.backend.mail.enabled", Boolean::class.java, false) && environment.getProperty("qanda.backend.mail.transport") == "tencent-ses") { "生产邮件须明确启用腾讯云SES API，不自动退回本地捕获" }
        require(environment.getProperty("BACKEND_SES_SEND_ENABLED", Boolean::class.java, false)) { "SES实发尚未获准启用" }
    }
}
