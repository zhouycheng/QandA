package qanda.backend.platform.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.web.filter.OncePerRequestFilter
import qanda.backend.identity.Sessions
import qanda.backend.platform.http.*
import org.springframework.http.HttpStatus
import org.springframework.core.env.Environment

@Configuration
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
class PlatformSecurity {
    private val accountLimiter=RequestLimiter()
    @Bean fun apiSecurity(http: HttpSecurity,sessions: Sessions,errors: ErrorWriter,environment: Environment): SecurityFilterChain = http
        .csrf { it.disable() }.requestCache { it.disable() }.httpBasic { it.disable() }.formLogin { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .authorizeHttpRequests { it.anyRequest().permitAll() }
        .addFilterBefore(object: OncePerRequestFilter() {
            override fun doFilterInternal(request: HttpServletRequest,response: HttpServletResponse,chain: FilterChain) {
                val path=request.requestURI
                if(!path.startsWith("/api/v1/")) { chain.doFilter(request,response);return }
                val public=PublicRoutes.permits(request.method,path)
                try {
                    val headers=request.getHeaders("Authorization").toList()
                    if(headers.isNotEmpty()) {
                        if(headers.size!=1 || !headers[0].startsWith("Bearer ")) throw ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请提供有效令牌")
                        val actor=sessions.authenticate(headers[0].substring(7))
                        val read=request.method in setOf("GET","HEAD")
                        val budget=environment.getProperty("qanda.backend.request-limits."+if(read) "read-per-account" else "write-per-account",Int::class.java,if(read) 600 else 120)
                        if(!accountLimiter.reserve("${actor.kind}:${actor.id}:$read",budget)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","请求过于频繁",details=ErrorDetails(retryAfterSeconds=60))
                        SecurityContextHolder.getContext().authentication=UsernamePasswordAuthenticationToken(actor,null,emptyList())
                    }
                    if(!public) {
                        val actor=sessions.current()
                        if(path.startsWith("/api/v1/admin/") && actor.kind!="ADMIN" || !path.startsWith("/api/v1/admin/") && !path.startsWith("/api/v1/files/") && actor.kind!="USER") forbidden()
                    }
                    chain.doFilter(request,response)
                } catch(error: ApiException) { errors.write(request,response,error) }
                catch(_: org.springframework.dao.DataAccessException) { errors.write(request,response,ApiException(HttpStatus.SERVICE_UNAVAILABLE,"IDENTITY_UNAVAILABLE","身份服务暂不可用")) }
                finally { SecurityContextHolder.clearContext() }
            }
        },UsernamePasswordAuthenticationFilter::class.java).build()
}
