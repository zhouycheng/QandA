package qanda.backend.identity

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment
import qanda.backend.platform.http.ApiException
import java.util.UUID

class IdentityCryptoTest {
    private val crypto = IdentityCrypto(MockEnvironment())
    @Test fun `password salt and exact unicode input are preserved`() {
        val raw = " 密码0123456789😀 "
        val first = crypto.preparePassword(raw)
        val second = crypto.preparePassword(raw)
        assertNotEquals(first.encoded,second.encoded)
        assertTrue(crypto.verifyPassword(raw,first.encoded))
        assertFalse(crypto.verifyPassword(raw.trim(),first.encoded))
        assertFalse(crypto.verifyPassword("wrong-password",null))
        assertFalse(first.toString().contains(first.encoded))
        assertTrue(crypto.verifyPassword("😀".repeat(12),crypto.preparePassword("😀".repeat(12)).encoded))
        assertThrows(ApiException::class.java) { crypto.preparePassword("😀".repeat(129)) }
        assertThrows(ApiException::class.java) { crypto.preparePassword("a".repeat(11)) }
    }
    @Test fun `email comparison does not fold provider aliases or accept header characters`() {
        assertEquals(Email("User+Tag@Example.com","user+tag@example.com"),email("  User+Tag@Example.com  "))
        assertNotEquals(email("a.b@example.com").key,email("ab@example.com").key)
        for (bad in listOf("a\r\n@example.com","a@example.com\r\n","你好@example.com","a..b@example.com","a@-example.com","a@")) assertThrows(ApiException::class.java) { email(bad) }
        assertEquals("Q友",nickname(" Q友 "))
        assertThrows(ApiException::class.java) { nickname("a\nb") }
    }
    @Test fun `local WeChat requires explicit loopback test mode and one use nonce`() {
        val production = OfficialWechatCodeExchange(MockEnvironment().withProperty("BACKEND_WECHAT_PROVIDER","local"),jacksonObjectMapper())
        assertEquals("WECHAT_UNAVAILABLE",assertThrows(ApiException::class.java) { production.exchange("local-learner-1:${UUID.randomUUID()}") }.code)
        val local = OfficialWechatCodeExchange(MockEnvironment().withProperty("BACKEND_WECHAT_PROVIDER","local").withProperty("qanda.backend.mode","test"),jacksonObjectMapper())
        val code = "local-learner-1:${UUID.randomUUID()}"
        assertEquals("local-learner-1",local.exchange(code).openId)
        assertEquals("WECHAT_CODE_INVALID",assertThrows(ApiException::class.java) { local.exchange(code) }.code)
        val missing = OfficialWechatCodeExchange(MockEnvironment(),jacksonObjectMapper())
        assertEquals("WECHAT_UNAVAILABLE",assertThrows(ApiException::class.java) { missing.exchange("some-code") }.code)
    }
    @Test fun `official provider parses identity only and sanitizes every failure`() {
        val provider = OfficialWechatCodeExchange(MockEnvironment(),jacksonObjectMapper())
        val result = provider.parseResponse("app","""{"openid":"identity","session_key":"never-expose-this","unionid":"union"}""".toByteArray())
        assertEquals("identity",result.openId)
        assertFalse(result.toString().contains("identity"))
        for ((body,status) in listOf("""{"errcode":40029,"errmsg":"SECRET"}""" to 401,"""{"errcode":45011,"errmsg":"SECRET"}""" to 429,"""{"errcode":-1,"errmsg":"SECRET"}""" to 503,"""{"openid":"x"}""" to 503,"not-json" to 503)) {
            val error = assertThrows(ApiException::class.java) { provider.parseResponse("app",body.toByteArray()) }
            assertEquals(status,error.status.value()); assertFalse(error.message.contains("SECRET"))
        }
    }
}
