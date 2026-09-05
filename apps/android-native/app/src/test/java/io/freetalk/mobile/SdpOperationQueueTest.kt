package io.freetalk.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class SdpOperationQueueTest {
    @Test fun remoteOfferOwnsQueueUntilAnswerIsSet() {
        val queue = SdpOperationQueue()
        val events = mutableListOf<String>()
        lateinit var answerSet: () -> Unit
        queue.submit { done -> events.add("remote offer"); answerSet = done }
        queue.submit { done -> events.add("local renegotiation"); done() }
        assertEquals(listOf("remote offer"), events)
        answerSet()
        assertEquals(listOf("remote offer", "local renegotiation"), events)
    }
    @Test fun collisionWaitsForLocalDescriptionBeforeRollback() {
        val queue = SdpOperationQueue()
        val events = mutableListOf<String>()
        lateinit var localSet: () -> Unit
        queue.submit { done -> events.add("create local"); localSet = done }
        queue.submit { done -> events.add("rollback then remote"); done() }
        assertEquals(listOf("create local"), events)
        localSet()
        assertEquals(listOf("create local", "rollback then remote"), events)
    }
    @Test fun completionIsIdempotentAndFailureCanReleaseQueue() {
        val queue = SdpOperationQueue()
        lateinit var failed: () -> Unit
        lateinit var second: () -> Unit
        var count = 0
        queue.submit { failed = it }
        queue.submit { count++; second = it }
        queue.submit { count++; it() }
        failed(); failed()
        assertEquals(1, count)
        second()
        assertEquals(2, count)
    }
    @Test fun closingDiscardsCallbacksForDepartedPeer() {
        val queue = SdpOperationQueue()
        lateinit var finish: () -> Unit
        var count = 0
        queue.submit { finish = it }
        queue.submit { count++; it() }
        queue.close(); finish()
        queue.submit { count++; it() }
        assertEquals(0, count)
    }
}
