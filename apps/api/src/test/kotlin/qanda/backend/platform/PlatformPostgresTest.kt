package qanda.backend.platform

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.client.TestRestTemplate
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.IllegalTransactionStateException
import qanda.backend.platform.transaction.JdbcTransactions
import java.util.UUID

@Tag("postgres")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlatformPostgresTest {
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var transactions: JdbcTransactions
    @Autowired lateinit var http: TestRestTemplate
    @Autowired lateinit var mapper: ObjectMapper
    @LocalServerPort var port: Int = 0
    private val schema = "platform_probe_" + UUID.randomUUID().toString().replace("-", "")

    @BeforeAll
    fun prepare() {
        assertEquals("qanda_backend", jdbc.queryForObject("SELECT current_database()", String::class.java))
        jdbc.execute("CREATE SCHEMA $schema")
        jdbc.execute("CREATE TABLE $schema.probe(id bigint PRIMARY KEY, value integer NOT NULL CHECK(value >= 0))")
    }

    @AfterAll
    fun cleanup() = jdbc.execute("DROP SCHEMA $schema CASCADE")

    @BeforeEach
    fun clear() = jdbc.execute("DELETE FROM $schema.probe")

    @Test
    fun `real migrations initialized the isolated database`() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*)::int FROM flyway_schema_history WHERE version='0001' AND success", Int::class.java)!!)
        assertEquals("UTC", jdbc.queryForObject("SHOW timezone", String::class.java))
    }

    @Test
    fun `mandatory shares one connection and root failure rolls every write back`() {
        assertThrows(IllegalStateException::class.java) {
            transactions.required {
                val pid = jdbc.queryForObject("SELECT pg_backend_pid()", Int::class.java)!!
                jdbc.update("INSERT INTO $schema.probe VALUES (1,1)")
                transactions.mandatory {
                    assertEquals(pid, jdbc.queryForObject("SELECT pg_backend_pid()", Int::class.java)!!)
                    jdbc.update("INSERT INTO $schema.probe VALUES (2,2)")
                }
                error("intentional root rollback")
            }
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*)::int FROM $schema.probe", Int::class.java)!!)
        assertThrows(IllegalTransactionStateException::class.java) { transactions.mandatory { Unit } }
    }

    @Test
    fun `source snapshot is readonly repeatable read and cannot replace a root`() {
        transactions.readOnlySnapshot {
            assertEquals("on", jdbc.queryForObject("SHOW transaction_read_only", String::class.java))
            assertEquals("repeatable read", jdbc.queryForObject("SHOW transaction_isolation", String::class.java))
        }
        assertThrows(IllegalStateException::class.java) { transactions.required { transactions.readOnlySnapshot { Unit } } }
        assertThrows(IllegalStateException::class.java) { transactions.readOnlySnapshot { transactions.mandatory { Unit } } }
    }

    @Test
    fun `unimplemented business routes have no success placeholder`() {
        val response = http.getForEntity("http://127.0.0.1:$port/api/v1/me", String::class.java)
        assertEquals(401, response.statusCode.value())
        val error = mapper.readTree(response.body)
        assertEquals("UNAUTHENTICATED", error["code"].asText())
        assertEquals(response.headers.getFirst("X-Request-Id"), error["requestId"].asText())
        assertEquals(setOf("code", "message", "fieldErrors", "requestId"), error.fieldNames().asSequence().toSet())
    }
}
