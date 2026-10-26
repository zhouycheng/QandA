package qanda.backend.platform.security

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorWriter

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class PlatformSecurity {
    @Bean
    @Order(Ordered.LOWEST_PRECEDENCE)
    fun closedFallback(http: HttpSecurity, errors: ErrorWriter): SecurityFilterChain = http
        .csrf { it.disable() }
        .requestCache { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .authorizeHttpRequests { it.anyRequest().denyAll() }
        .exceptionHandling {
            it.authenticationEntryPoint { request, response, _ -> errors.write(request, response, ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "请提供有效令牌")) }
            it.accessDeniedHandler { request, response, _ -> errors.write(request, response, ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "无权执行此操作")) }
        }.build()
}
