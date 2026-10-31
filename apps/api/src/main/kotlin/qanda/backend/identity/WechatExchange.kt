package qanda.backend.identity

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.core.env.Environment
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import qanda.backend.identity.api.WechatCodeExchange
import qanda.backend.identity.api.WechatIdentity
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.ErrorDetails
import qanda.backend.platform.config.BackendSafety
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Flow
import java.util.concurrent.TimeUnit

@Component
class OfficialWechatCodeExchange(private val environment: Environment, private val mapper: ObjectMapper) : WechatCodeExchange {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build()
    private val localCodes = ConcurrentHashMap.newKeySet<String>()
    override fun exchange(code: String): WechatIdentity {
        wechatCode(code)
        return when (environment.getProperty("BACKEND_WECHAT_PROVIDER","official")) {
            "official" -> official(code)
            "local" -> local(code)
            else -> unavailable("WECHAT_UNAVAILABLE")
        }
    }
    private fun local(code: String): WechatIdentity {
        if (environment.getProperty("qanda.backend.mode","production") !in setOf("local","test") || !BackendSafety.localBindingAllowed(environment.getProperty("server.address","127.0.0.1"),environment.getProperty("BACKEND_LOCAL_CONTAINER",Boolean::class.java,false))) unavailable("WECHAT_UNAVAILABLE")
        val parts = code.split(':',limit=2)
        if (parts.size != 2 || parts[0] !in setOf("local-learner-1","local-learner-2","local-learner-3") || runCatching { UUID.fromString(parts[1]).toString() == parts[1] }.getOrDefault(false) != true || !localCodes.add(code)) invalidCode()
        return WechatIdentity("local-test-app",parts[0],null)
    }
    private fun official(code: String): WechatIdentity {
        val appId = environment.getProperty("BACKEND_WECHAT_APP_ID")?.takeIf { it.matches(Regex("wx[A-Za-z0-9]{16}")) } ?: unavailable("WECHAT_UNAVAILABLE")
        val secret = environment.getProperty("BACKEND_WECHAT_APP_SECRET")?.takeIf { it.isNotBlank() && it.length <= 256 } ?: unavailable("WECHAT_UNAVAILABLE")
        val query = listOf("appid" to appId,"secret" to secret,"js_code" to code,"grant_type" to "authorization_code")
            .joinToString("&") { (name,value) -> "$name=${URLEncoder.encode(value,UTF_8)}" }
        val response = try {
            client.sendAsync(HttpRequest.newBuilder(URI("https://api.weixin.qq.com/sns/jscode2session?$query")).timeout(Duration.ofSeconds(5)).GET().build(),HttpResponse.BodyHandler { LimitedBody() })
                .orTimeout(5,TimeUnit.SECONDS).get(6,TimeUnit.SECONDS)
        } catch (_: Exception) { unavailable("WECHAT_UNAVAILABLE") }
        if (response.statusCode() != 200) unavailable("WECHAT_UNAVAILABLE")
        return parseResponse(appId,response.body())
    }
    internal fun parseResponse(appId: String, bytes: ByteArray): WechatIdentity {
        if (bytes.size > 16384) unavailable("WECHAT_UNAVAILABLE")
        val body = try { mapper.readTree(bytes) } catch (_: Exception) { unavailable("WECHAT_UNAVAILABLE") }
        if (!body.isObject || (body.has("errcode") && !body["errcode"].canConvertToInt())) unavailable("WECHAT_UNAVAILABLE")
        when (body.path("errcode").asInt(0)) {
            0 -> Unit
            40029,40163,40226 -> invalidCode()
            45011 -> throw ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","微信请求过于频繁，请稍后重试",details=ErrorDetails(retryAfterSeconds=60))
            else -> unavailable("WECHAT_UNAVAILABLE")
        }
        fun field(name: String): String = body[name]?.takeIf { it.isTextual }?.asText()?.takeIf { it.length in 1..128 && it.none { c -> c.code < 32 || c.code == 127 } } ?: unavailable("WECHAT_UNAVAILABLE")
        val openId = field("openid")
        field("session_key")
        val unionId = if (body.has("unionid")) field("unionid") else null
        return WechatIdentity(appId,openId,unionId)
    }
    private fun invalidCode(): Nothing = throw ApiException(HttpStatus.UNAUTHORIZED,"WECHAT_CODE_INVALID","微信登录凭证无效，请重新获取")
    private class LimitedBody : HttpResponse.BodySubscriber<ByteArray> {
        private val result = CompletableFuture<ByteArray>()
        private val buffer = ByteArrayOutputStream()
        private lateinit var subscription: Flow.Subscription
        override fun getBody() = result
        override fun onSubscribe(subscription: Flow.Subscription) { this.subscription = subscription; subscription.request(1) }
        override fun onNext(items: MutableList<ByteBuffer>) {
            for (item in items) {
                if (buffer.size()+item.remaining() > 16384) { subscription.cancel(); result.completeExceptionally(IllegalStateException("Oversized provider response")); return }
                val bytes = ByteArray(item.remaining()); item.get(bytes); buffer.write(bytes)
            }
            subscription.request(1)
        }
        override fun onError(error: Throwable) { result.completeExceptionally(error) }
        override fun onComplete() { result.complete(buffer.toByteArray()) }
    }
}
