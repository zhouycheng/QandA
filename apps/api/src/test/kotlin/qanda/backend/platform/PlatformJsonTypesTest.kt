package qanda.backend.platform

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.KotlinModule
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder
import qanda.backend.platform.config.PlatformConfiguration
import java.time.Instant

@Tag("platform-acceptance")
@Tag("platform-boundary")
class PlatformJsonTypesTest {
    private val builder = Jackson2ObjectMapperBuilder.json().modules(KotlinModule.Builder().build(), JavaTimeModule())
    private val mapper = builder.also { PlatformConfiguration().strictJson().customize(it) }.build<ObjectMapper>()
    enum class State { ACTIVE, INACTIVE }
    data class Input(val version: Long, val expectedVersion: Long?, val enabled: Boolean, val nickname: String, val at: Instant, val state: State, val description: String)
    private val valid = """{"version":1,"expectedVersion":null,"enabled":true,"nickname":"学员","at":"2026-10-26T00:00:00Z","state":"ACTIVE","description":""}"""

    @Test fun `valid nullable integer boolean enum time and empty text remain compatible`() {
        val result = mapper.readValue(valid, Input::class.java)
        assertEquals(1L, result.version)
        assertNull(result.expectedVersion)
        assertTrue(result.enabled)
        assertEquals(State.ACTIVE, result.state)
        assertEquals(Instant.parse("2026-10-26T00:00:00Z"), result.at)
        assertEquals("", result.description)
    }
    @Test fun `string and fractional integer versions are rejected including nullable versions`() {
        for (input in listOf(valid.replace("\"version\":1", "\"version\":\"1\""), valid.replace("\"version\":1", "\"version\":1.5"), valid.replace("\"expectedVersion\":null", "\"expectedVersion\":\"1\""), valid.replace("\"expectedVersion\":null", "\"expectedVersion\":\"\""), valid.replace("\"version\":1", "\"version\":null"))) {
            assertThrows(JsonProcessingException::class.java, { mapper.readValue(input, Input::class.java) }, input)
        }
    }
    @Test fun `boolean text enum and time do not accept different json scalar types`() {
        for (input in listOf(valid.replace("\"enabled\":true", "\"enabled\":\"true\""), valid.replace("\"enabled\":true", "\"enabled\":1"), valid.replace("\"nickname\":\"学员\"", "\"nickname\":123"), valid.replace("\"nickname\":\"学员\"", "\"nickname\":true"), valid.replace("\"state\":\"ACTIVE\"", "\"state\":0"), valid.replace("\"at\":\"2026-10-26T00:00:00Z\"", "\"at\":0"))) {
            assertThrows(JsonProcessingException::class.java, { mapper.readValue(input, Input::class.java) }, input)
        }
    }
}
