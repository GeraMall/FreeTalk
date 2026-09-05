package io.freetalk.mobile

/** Main-thread queue. An operation owns the queue until its asynchronous callback finishes. */
internal class SdpOperationQueue {
    private val pending = ArrayDeque<((() -> Unit) -> Unit)>()
    private var busy = false
    private var closed = false
    fun submit(operation: (() -> Unit) -> Unit) {
        if (closed) return
        pending.addLast(operation)
        drain()
    }
    fun close() { closed = true; pending.clear() }
    private fun drain() {
        if (closed || busy || pending.isEmpty()) return
        busy = true
        var finished = false
        pending.removeFirst().invoke {
            if (!finished) {
                finished = true
                busy = false
                drain()
            }
        }
    }
}
