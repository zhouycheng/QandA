package qanda.backend.identity.api

class PreparedPassword(val encoded: String) { override fun toString() = "PreparedPassword([REDACTED])" }
class WechatIdentity(val appId: String, val openId: String, val unionId: String?) { override fun toString() = "WechatIdentity([REDACTED])" }
interface WechatCodeExchange { fun exchange(code: String): WechatIdentity }
