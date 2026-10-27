package qanda.backend.identity

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import java.nio.file.Path

class IdentityContractTest {
    @Test fun `all eighteen operation IDs methods paths statuses and request media match owner OpenAPI`() {
        val contract = jacksonObjectMapper().readTree(Path.of("contracts/modules/identity/openapi.yaml").toFile())
        val methods = IdentityController::class.java.declaredMethods.mapNotNull { method ->
            AnnotatedElementUtils.findMergedAnnotation(method,RequestMapping::class.java)?.let { method to it }
        }
        assertEquals(18,methods.size)
        for ((path,operations) in contract["paths"].properties()) for ((verb,operation) in operations.properties()) {
            val method = methods.single { it.first.name == operation["operationId"].asText() }
            assertEquals(path,method.second.path.single())
            assertEquals(verb.uppercase(),method.second.method.single().name)
            val expectedStatus = operation["responses"].fieldNames().asSequence().single { it.startsWith("2") }.toInt()
            assertEquals(expectedStatus,method.first.getAnnotation(ResponseStatus::class.java)?.value?.value() ?: 200)
            if (operation.has("requestBody")) assertEquals(listOf("application/json"),method.second.consumes.toList())
        }
    }
}
