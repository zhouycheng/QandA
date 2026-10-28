package qanda.backend.platform.config

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonGenerator
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.JsonSerializer
import com.fasterxml.jackson.databind.SerializerProvider
import com.fasterxml.jackson.databind.cfg.CoercionAction
import com.fasterxml.jackson.databind.cfg.CoercionInputShape
import com.fasterxml.jackson.databind.type.LogicalType
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer
import org.springframework.beans.factory.InitializingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import qanda.backend.platform.security.CommandDigests
import java.time.Clock
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.time.format.DateTimeParseException
import java.util.Base64

@Configuration
class PlatformConfiguration {
    @Bean
    fun clock(): Clock = Clock.systemUTC()

    @Bean
    fun strictJson() = Jackson2ObjectMapperBuilderCustomizer { builder ->
        builder.featuresToEnable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION, DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
        builder.featuresToEnable(DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
        builder.postConfigurer { mapper ->
            for (type in listOf(LogicalType.Integer, LogicalType.Float, LogicalType.Boolean, LogicalType.Enum, LogicalType.DateTime)) {
                val coercion = mapper.coercionConfigFor(type)
                coercion.setCoercion(CoercionInputShape.String, if (type in listOf(LogicalType.Enum, LogicalType.DateTime)) CoercionAction.TryConvert else CoercionAction.Fail)
                coercion.setCoercion(CoercionInputShape.EmptyString, CoercionAction.Fail)
                coercion.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail)
                coercion.setCoercion(CoercionInputShape.Float, if (type == LogicalType.Float) CoercionAction.TryConvert else CoercionAction.Fail)
                if (type != LogicalType.Integer && type != LogicalType.Float) coercion.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
            }
            for (shape in listOf(CoercionInputShape.Integer, CoercionInputShape.Float, CoercionInputShape.Boolean)) {
                mapper.coercionConfigFor(LogicalType.Textual).setCoercion(shape, CoercionAction.Fail)
            }
        }
        val format = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
        builder.serializerByType(Instant::class.java, object : JsonSerializer<Instant>() {
            override fun serialize(value: Instant, generator: JsonGenerator, provider: SerializerProvider) = generator.writeString(format.format(value))
        })
        builder.deserializerByType(Instant::class.java, object : JsonDeserializer<Instant>() {
            override fun deserialize(parser: JsonParser, context: DeserializationContext): Instant {
                if (!parser.hasToken(JsonToken.VALUE_STRING)) return context.handleUnexpectedToken(Instant::class.java, parser) as Instant
                return try { Instant.parse(parser.text) }
                catch (_: DateTimeParseException) { throw context.weirdStringException(parser.text, Instant::class.java, "Expected an ISO-8601 instant") }
            }
        })
    }

    @Bean
    fun commandDigests(environment: Environment): CommandDigests {
        val keys = try {
            val entries = environment.getRequiredProperty("BACKEND_COMMAND_DIGEST_KEYS").split(',').map { entry ->
                val parts = entry.split(':', limit = 2)
                require(parts.size == 2)
                parts[0].toInt() to Base64.getDecoder().decode(parts[1])
            }
            require(entries.map { it.first }.distinct().size == entries.size)
            entries.toMap()
        } catch (_: Exception) {
            error("BACKEND_COMMAND_DIGEST_KEYS must contain version:base64 entries")
        }
        return CommandDigests(environment.getProperty("BACKEND_COMMAND_DIGEST_ACTIVE_VERSION", Int::class.java, 1), keys)
    }

    @Bean
    fun backendSafety(environment: Environment) = InitializingBean { BackendSafety(
        environment.getProperty("qanda.backend.mode", "production"),
        environment.getProperty("server.address", "127.0.0.1"),
        environment.getRequiredProperty("spring.datasource.url"),
        environment.getRequiredProperty("spring.datasource.password"),
    ) }
}

class BackendSafety(mode: String, address: String, databaseUrl: String, password: String) {
    init {
        require(mode in setOf("local", "test", "production")) { "Unknown backend mode" }
        require(mode == "production" || address in setOf("127.0.0.1", "::1")) { "Local/test mode requires loopback binding" }
        require(databaseUrl.matches(Regex("jdbc:postgresql://[^/]+/qanda_backend(?:\\?.*)?"))) { "The backend requires the dedicated qanda_backend database" }
        require(password.isNotBlank()) { "Backend database password is required" }
    }
}
