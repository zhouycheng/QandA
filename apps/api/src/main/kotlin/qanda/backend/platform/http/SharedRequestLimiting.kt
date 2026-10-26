package qanda.backend.platform.http

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import qanda.backend.identity.IdentityController
import qanda.backend.identity.IdentityGuards
import qanda.backend.identity.api.AuthContext
import qanda.backend.platform.transaction.JdbcTransactions
import java.security.MessageDigest
import java.time.Clock
import java.util.HexFormat

// shortcut: budgets belong to one backend process; use a shared limiter before multi-instance deployment.
class SharedRequestLimiter(private val environment: Environment, private val nanoTime: () -> Long = System::nanoTime) {
    private fun setting(name: String, default: Int, range: IntRange) = environment.getProperty("qanda.backend.request-limits.$name", Int::class.java, default).also {
        require(it in range) { "Request-limit $name is outside its supported range" }
    }
    val readPerAccount = setting("read-per-account", 600, 1..1_000_000)
    val writePerAccount = setting("write-per-account", 120, 1..1_000_000)
    val anonymousPerPeer = setting("anonymous-per-peer", 60_000, 1..1_000_000)
    private val windowNanos = setting("window-seconds", 60, 1..3600) * 1_000_000_000L
    private val maxKeys = setting("max-keys", 100_000, 1..1_000_000)
    private data class Bucket(val started: Long, var used: Int)
    private val buckets = HashMap<String, Bucket>()
    private var lastSweep = nanoTime()

    @Synchronized internal fun reserve(key: String, budget: Int): Int? {
        val now = nanoTime()
        if (now - lastSweep >= 1_000_000_000L) {
            buckets.entries.removeIf { now - it.value.started >= windowNanos }
            lastSweep = now
        }
        var bucket = buckets[key]
        if (bucket == null || now - bucket.started >= windowNanos) {
            if (bucket == null && buckets.size >= maxKeys) return 1
            bucket = Bucket(now, 0)
            buckets[key] = bucket
        }
        if (bucket.used >= budget) return ((windowNanos - (now - bucket.started) + 999_999_999L) / 1_000_000_000L).toInt().coerceAtLeast(1)
        bucket.used++
        return null
    }
}

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class SharedRequestLimitConfiguration {
    @Bean fun sharedRequestLimiter(environment: Environment) = SharedRequestLimiter(environment)

    @Bean fun sharedRequestLimitMvc(limiter: SharedRequestLimiter, guards: ObjectProvider<IdentityGuards>, tx: JdbcTransactions, clock: Clock) = object : WebMvcConfigurer {
        override fun addInterceptors(registry: InterceptorRegistry) {
            registry.addInterceptor(object : HandlerInterceptor {
                override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
                    if (handler !is HandlerMethod || IdentityController::class.java.isAssignableFrom(handler.beanType)) return true
                    val read = request.method in setOf("GET", "HEAD")
                    if (!read && request.method !in setOf("POST", "PUT", "PATCH", "DELETE")) return true
                    val authenticated = SecurityContextHolder.getContext().authentication?.takeIf { it.isAuthenticated }?.principal as? AuthContext
                    val actor = authenticated ?: optionalIdentity(request, guards, tx, clock)
                    val scope = if (read) "READ" else "WRITE"
                    val key = if (actor != null) "$scope:account:${actor.accountId}" else {
                        val peer = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(request.remoteAddr.toByteArray(Charsets.UTF_8)))
                        "$scope:peer:$peer"
                    }
                    val budget = if (actor == null) limiter.anonymousPerPeer else if (read) limiter.readPerAccount else limiter.writePerAccount
                    limiter.reserve(key, budget)?.let { retry ->
                        throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "请求过于频繁，请稍后重试", details = ErrorDetails(retryAfterSeconds = retry))
                    }
                    return true
                }
            }).addPathPatterns("/api/v1/**")
        }
    }

    private fun optionalIdentity(request: HttpServletRequest, guards: ObjectProvider<IdentityGuards>, tx: JdbcTransactions, clock: Clock): AuthContext? {
        val header = request.getHeaders("Authorization").toList().singleOrNull() ?: return null
        if (!header.startsWith("Bearer ", ignoreCase = true)) return null
        return try {
            val identity = guards.ifAvailable ?: throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE", "身份服务暂时不可用")
            tx.required { identity.authenticate(header.substring(7), clock.instant()) }
        } catch (error: ApiException) {
            if (error.status == HttpStatus.UNAUTHORIZED) null else throw error
        } catch (_: DataAccessException) {
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE", "身份服务暂时不可用")
        }
    }
}
