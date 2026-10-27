package qanda.backend.platform.http

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

@Tag("platform-acceptance")
@Tag("platform-rate-limit")
class SharedRequestLimiterTest {
    @Test fun `fixed window retry is positive rounded up and blocked requests do not extend it`() {
        val now = AtomicLong(0)
        val limiter = SharedRequestLimiter(MockEnvironment(), now::get)
        repeat(2) { assertNull(limiter.reserve("READ:fixture", 2)) }
        assertEquals(60, limiter.reserve("READ:fixture", 2))
        now.set(59_500_000_000)
        assertEquals(1, limiter.reserve("READ:fixture", 2))
        now.set(60_000_000_000)
        assertNull(limiter.reserve("READ:fixture", 2))
    }
    @Test fun `bounded state rejects new keys without evicting live budgets and reclaims expired keys`() {
        val now = AtomicLong(0)
        val limiter = SharedRequestLimiter(MockEnvironment().withProperty("qanda.backend.request-limits.max-keys", "1"), now::get)
        assertNull(limiter.reserve("account-1", 1))
        assertEquals(1, limiter.reserve("account-2", 1))
        assertEquals(60, limiter.reserve("account-1", 1))
        now.set(61_000_000_000)
        assertNull(limiter.reserve("account-2", 1))
    }
    @Test fun `parallel reservations cannot overspend one budget`() {
        val limiter = SharedRequestLimiter(MockEnvironment())
        val pool = Executors.newFixedThreadPool(4)
        val results = try { pool.invokeAll((1..12).map { Callable { limiter.reserve("same-account", 3) } }).map { it.get() } } finally { pool.shutdownNow() }
        assertEquals(3, results.count { it == null })
        assertTrue(results.filterNotNull().all { it > 0 })
    }
    @Test fun `defaults separate account reads writes and NAT shared traffic with valid positive configuration`() {
        val limiter = SharedRequestLimiter(MockEnvironment())
        assertEquals(600, limiter.readPerAccount); assertEquals(120, limiter.writePerAccount)
        assertEquals(60_000, limiter.anonymousPerPeer)
        for (name in listOf("read-per-account", "write-per-account", "anonymous-per-peer", "window-seconds", "max-keys")) {
            assertThrows(IllegalArgumentException::class.java) { SharedRequestLimiter(MockEnvironment().withProperty("qanda.backend.request-limits.$name", "0")) }
        }
    }
}
