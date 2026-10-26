package qanda.backend.adminsecurity

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import qanda.backend.adminsecurity.api.AuditAction
import qanda.backend.adminsecurity.api.AuditField
import java.nio.file.Path

class AdminContractTest {
    @Test fun `eight operation IDs methods paths statuses media and canonical audit enums match owner OpenAPI`() {
        val contract=jacksonObjectMapper().readTree(Path.of("contracts/modules/admin-security/openapi.yaml").toFile())
        val base=AdminController::class.java.getAnnotation(RequestMapping::class.java).value.single()
        val methods=AdminController::class.java.declaredMethods.mapNotNull { method -> AnnotatedElementUtils.findMergedAnnotation(method,RequestMapping::class.java)?.let { method to it } }
        assertEquals(8,methods.size)
        for((path,operations) in contract["paths"].properties()) for((verb,operation) in operations.properties()) {
            val (method,mapping)=methods.single { it.first.name==operation["operationId"].asText() }
            assertEquals("/api/v1$path",base+mapping.path.single())
            assertEquals(verb.uppercase(),mapping.method.single().name)
            assertEquals(operation["responses"].fieldNames().asSequence().single { it.startsWith("2") }.toInt(),method.getAnnotation(ResponseStatus::class.java)?.value?.value() ?: 200)
            if(operation.has("requestBody")) assertEquals(listOf("application/json"),mapping.consumes.toList())
        }
        val schemas=contract["components"]["schemas"]
        assertEquals(schemas["AuditAction"]["enum"].map { it.asText() }.toSet(),AuditAction.entries.map { it.name }.toSet())
        assertEquals(schemas["AuditChange"]["oneOf"].map { it["properties"]["field"]["const"].asText() }.toSet(),AuditField.entries.map { it.name }.toSet())
    }
}
