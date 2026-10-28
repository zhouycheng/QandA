package qanda.backend.platform.http

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.stereotype.Component
import org.springframework.web.HttpMediaTypeNotSupportedException
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.bind.ServletRequestBindingException
import org.springframework.beans.TypeMismatchException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.servlet.resource.NoResourceFoundException
import java.util.UUID
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.TransientDataAccessException
import org.springframework.beans.factory.ObjectProvider
import qanda.backend.platform.security.AuditFailures

data class FieldError(val field: String, val code: String, val message: String)

data class ErrorDetails(
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val currentVersion: Long? = null,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val retryAfterSeconds: Int? = null,
)

data class ApiError(
    val code: String,
    val message: String,
    val fieldErrors: List<FieldError>,
    val requestId: UUID,
    @get:JsonInclude(JsonInclude.Include.NON_NULL) val details: ErrorDetails? = null,
)

class ApiException(
    val status: HttpStatus,
    val code: String,
    override val message: String,
    val fieldErrors: List<FieldError> = emptyList(),
    val details: ErrorDetails? = null,
) : RuntimeException(message) {
    init {
        require(status.isError && code.matches(Regex("[A-Z][A-Z0-9_]*")) && message.isNotBlank())
    }

    fun body(request: HttpServletRequest) = ApiError(code, message, fieldErrors, RequestIds.get(request), details)
}

@Component
class ErrorWriter(private val mapper: ObjectMapper,private val audits: ObjectProvider<AuditFailures>) {
    fun write(request: HttpServletRequest, response: HttpServletResponse, error: ApiException) {
        try { audits.ifAvailable?.record(request,error.code) } catch(_: Exception) { LoggerFactory.getLogger(javaClass).warn("Failure audit unavailable") }
        response.status = error.status.value()
        response.contentType = "application/json"
        response.characterEncoding = "UTF-8"
        response.setHeader("Cache-Control", "no-store")
        response.setHeader(RequestIds.HEADER, RequestIds.get(request).toString())
        error.details?.retryAfterSeconds?.let { response.setHeader("Retry-After", it.toString()) }
        mapper.writeValue(response.outputStream, error.body(request))
    }
}

@RestControllerAdvice
class ApiExceptionHandler(private val audits: ObjectProvider<AuditFailures>) {
    private val log = LoggerFactory.getLogger(javaClass)

    @ExceptionHandler(ApiException::class)
    fun business(error: ApiException, request: HttpServletRequest): ResponseEntity<ApiError> {
        try { audits.ifAvailable?.record(request,error.code) } catch(_: Exception) { log.warn("Failure audit unavailable") }
        val response = ResponseEntity.status(error.status).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
        error.details?.retryAfterSeconds?.let { response.header("Retry-After", it.toString()) }
        return response.body(error.body(request))
    }

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun integrity(request: HttpServletRequest) = business(ApiException(HttpStatus.CONFLICT,"RELATION_CONFLICT","记录已存在或仍有关联数据"),request)

    @ExceptionHandler(TransientDataAccessException::class)
    fun transientFailure(request: HttpServletRequest) = business(ApiException(HttpStatus.SERVICE_UNAVAILABLE,"TEMPORARILY_UNAVAILABLE","服务繁忙，请使用原请求标识重试"),request)

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(request: HttpServletRequest) = business(ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请求JSON格式或字段不符合要求"), request)

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalid(error: MethodArgumentNotValidException, request: HttpServletRequest): ResponseEntity<ApiError> {
        val fields = error.bindingResult.fieldErrors.map {
            FieldError("/" + it.field.replace("~", "~0").replace("/", "~1").replace(".", "/"), "INVALID_FIELD", "字段不符合要求")
        }
        return business(ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "请检查请求字段", fields), request)
    }

    @ExceptionHandler(NoResourceFoundException::class)
    fun missing(request: HttpServletRequest) = business(ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "资源不存在"), request)

    @ExceptionHandler(HttpRequestMethodNotSupportedException::class)
    fun method(request: HttpServletRequest) = business(ApiException(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "请求方法不受支持"), request)

    @ExceptionHandler(HttpMediaTypeNotSupportedException::class)
    fun media(request: HttpServletRequest) = business(ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "请求媒体类型不受支持"), request)

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException::class)
    fun acceptable(request: HttpServletRequest) = business(ApiException(HttpStatus.NOT_ACCEPTABLE, "NOT_ACCEPTABLE", "请求的响应媒体类型不受支持"), request)

    @ExceptionHandler(TypeMismatchException::class, ServletRequestBindingException::class)
    fun parameter(request: HttpServletRequest) = business(ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请求参数不符合要求"), request)

    @ExceptionHandler(Exception::class)
    fun unexpected(error: Exception, request: HttpServletRequest): ResponseEntity<ApiError> {
        log.error("Request failed: requestId={}, exceptionType={}", RequestIds.get(request), error.javaClass.simpleName)
        return business(ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "服务暂时无法处理请求"), request)
    }
}
