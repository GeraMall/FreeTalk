package io.freetalk.mobile

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ServerEndpointsTest {
    private fun health() = MockResponse().setBody("""{"ok":true,"service":"freetalk-api"}""")
    private fun withServers(test: (MockWebServer, MockWebServer, ServerEndpoints) -> Unit) {
        val primary = MockWebServer(); val reserve = MockWebServer()
        primary.start(); reserve.start()
        try {
            val client = OkHttpClient.Builder().followRedirects(false).retryOnConnectionFailure(false).build()
            test(primary, reserve, ServerEndpoints(listOf(
                primary.url("/api").toString(), reserve.url("/api").toString(),
            ), client))
        } finally { primary.shutdown(); reserve.shutdown() }
    }

    @Test fun readFailsOverAfterAnUnavailablePrimaryWithoutLeakingProbeCredentials() = withServers { primary, reserve, pool ->
        primary.enqueue(health()); primary.enqueue(MockResponse().setResponseCode(503))
        reserve.enqueue(health()); reserve.enqueue(MockResponse().setBody("ok"))
        pool.execute("/v1/me") { it.header("Authorization", "Bearer test-only").build() }.use {
            assertEquals("ok", it.body!!.string())
        }
        assertNull(primary.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer test-only", primary.takeRequest().getHeader("Authorization"))
        assertNull(reserve.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer test-only", reserve.takeRequest().getHeader("Authorization"))
        assertTrue(pool.current.contains(reserve.port.toString()))
    }

    @Test fun writeIsNeverReplayedOnTheReserve() = withServers { primary, reserve, pool ->
        primary.enqueue(health()); primary.enqueue(MockResponse().setResponseCode(503))
        pool.execute("/v1/messages") { it.post("test".toRequestBody()).build() }.use { assertEquals(503, it.code) }
        assertEquals(2, primary.requestCount)
        assertEquals(0, reserve.requestCount)
    }

    @Test fun redirectsDoNotReceiveCredentialsOrTriggerAMutationReplay() = withServers { primary, reserve, pool ->
        primary.enqueue(health())
        primary.enqueue(MockResponse().setResponseCode(307).setHeader("Location", reserve.url("/steal")))
        pool.execute("/v1/me") { it.header("Authorization", "Bearer test-only").build() }.use { assertEquals(307, it.code) }
        assertEquals(0, reserve.requestCount)
    }

    @Test fun standbyHealthIsRejectedAndSelectionIsCached() = withServers { primary, reserve, pool ->
        primary.enqueue(MockResponse().setResponseCode(503)); reserve.enqueue(health())
        assertEquals(reserve.url("/api").toString(), pool.ready())
        assertEquals(pool.ready(), pool.current)
        assertEquals(1, primary.requestCount); assertEquals(1, reserve.requestCount)
    }
}
