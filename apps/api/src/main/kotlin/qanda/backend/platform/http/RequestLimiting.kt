package qanda.backend.platform.http

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.security.MessageDigest
import java.util.HexFormat

// shortcut: request budgets belong to one process; use a shared limiter before multi-instance deployment.
class RequestLimiter(private val maxKeys: Int=100000,private val nanoTime: () -> Long=System::nanoTime) {
    private data class Bucket(val start: Long,var count: Int)
    private val buckets=HashMap<String,Bucket>()
    private var lastSweep=nanoTime()
    @Synchronized fun reserve(key: String,budget: Int): Boolean {
        val now=nanoTime()
        if(now-lastSweep>=1_000_000_000L) { buckets.entries.removeIf { now-it.value.start>=60_000_000_000L };lastSweep=now }
        val previous=buckets[key]
        val bucket=previous?.takeIf { now-it.start<60_000_000_000L } ?: run { if(previous==null && buckets.size>=maxKeys) return false;Bucket(now,0).also { buckets[key]=it } }
        if(bucket.count>=budget) return false
        bucket.count++;return true
    }
}

@Component
@Order(Ordered.HIGHEST_PRECEDENCE+3)
class RequestLimitFilter(private val errors: ErrorWriter,private val environment: Environment): OncePerRequestFilter() {
    private val limiter=RequestLimiter()
    override fun doFilterInternal(request: HttpServletRequest,response: HttpServletResponse,chain: FilterChain) {
        if(request.requestURI.startsWith("/api/v1/")) {
            val peer=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(request.remoteAddr.toByteArray()))
            val budget=environment.getProperty("qanda.backend.request-limits.anonymous-per-peer",Int::class.java,60000)
            if(!limiter.reserve(peer,budget)) { errors.write(request,response,ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","请求过于频繁",details=ErrorDetails(retryAfterSeconds=60)));return }
        }
        chain.doFilter(request,response)
    }
}
