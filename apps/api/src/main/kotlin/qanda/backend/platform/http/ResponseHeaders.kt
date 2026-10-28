package qanda.backend.platform.http

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class ResponseHeaders: OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest,response: HttpServletResponse,chain: FilterChain) {
        if(request.requestURI.startsWith("/api/")) { response.setHeader("Cache-Control","no-store");response.setHeader("X-Content-Type-Options","nosniff") }
        chain.doFilter(request,response)
    }
}
