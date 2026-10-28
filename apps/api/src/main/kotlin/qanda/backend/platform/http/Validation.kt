package qanda.backend.platform.http

import org.springframework.http.HttpStatus
import java.text.Normalizer
import java.util.UUID

fun invalid(pointer: String = "", code: String = "VALIDATION_FAILED", message: String = "字段不符合要求"): Nothing =
    throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, listOf(FieldError(pointer, code, message)))
fun missing(): Nothing = throw ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "资源不存在或不可访问")
fun forbidden(): Nothing = throw ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "无权执行此操作")
fun conflict(code: String = "VERSION_CONFLICT", message: String = "资料已变化，请重新读取"): Nothing = throw ApiException(HttpStatus.CONFLICT, code, message)
fun requireVersion(expected: Long, actual: Long?) {
    if(expected<1) invalid("/expectedVersion")
    if(expected!=actual) throw ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","资料已变化，请重新读取",details=ErrorDetails(currentVersion=actual))
}
fun name(value: String, maximum: Int = 120): String = Normalizer.normalize(value.trim(), Normalizer.Form.NFC).also {
    if (it.codePointCount(0,it.length) !in 1..maximum || it.any { c -> c.code < 32 || c.code == 127 }) invalid("/name")
}
fun text(value: String, maximum: Int = 10000): String = value.also { if (it.length > maximum || '\u0000' in it) invalid("/text") }
fun activeStatus(value: String): String = value.also { if (it !in setOf("ACTIVE", "INACTIVE")) invalid("/status") }
data class MutationResult(val id: UUID, val version: Long)
data class Page<T>(val items: List<T>, val total: Long, val page: Int, val pageSize: Int)
data class PageSpec(val page: Int = 1, val pageSize: Int = 20) {
    init { if(page<1 || pageSize !in 1..100 || page>1_000_000) invalid("/page") }
    val offset: Int get() = (page-1)*pageSize
}
