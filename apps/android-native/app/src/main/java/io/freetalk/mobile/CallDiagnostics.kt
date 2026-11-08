package io.freetalk.mobile

import org.json.JSONArray
import org.json.JSONObject

/** Local, bounded call trace. No SDP, candidates, credentials, names or account/room IDs. */
internal class CallTrace(private val clock: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private val started = clock()
    private val labels = linkedMapOf<String, String>()
    private val events = ArrayDeque<JSONObject>()
    private val counters = linkedMapOf<String, Int>()
    @Synchronized fun event(kind: String, peer: String? = null, value: String? = null) {
        val item = JSONObject().put("ms", clock() - started).put("event", kind)
        if (peer != null) item.put("peer", labels.getOrPut(peer) { "peer-${labels.size + 1}" })
        if (value != null) item.put("value", value)
        events.addLast(item)
        while (events.size > 160) events.removeFirst()
    }
    @Synchronized fun count(kind: String) { counters[kind] = (counters[kind] ?: 0) + 1 }
    @Synchronized fun snapshot(): JSONObject = JSONObject()
        .put("elapsedMs", clock() - started).put("counters", JSONObject(counters.toMap()))
        .put("events", JSONArray(events.map { JSONObject(it.toString()) }))
}

internal object CallDiagnostics {
    private var trace = CallTrace()
    @Synchronized fun begin(server: String?): CallTrace {
        trace = CallTrace()
        trace.event("signaling-endpoint", value = when {
            server?.contains("185-225-201-129") == true -> "Moscow-primary"
            server?.contains("191-44-38-60") == true -> "Petersburg-reserve"
            else -> "other"
        })
        return trace
    }
    @Synchronized fun export(): String = JSONObject()
        .put("version", BuildConfig.VERSION_NAME).put("source", BuildConfig.BUILD_COMMIT)
        .put("androidSdk", android.os.Build.VERSION.SDK_INT)
        .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
        .put("abis", JSONArray(android.os.Build.SUPPORTED_ABIS.toList()))
        .put("call", trace.snapshot()).toString(2)
}
