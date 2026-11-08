package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test

class CallTraceTest {
    @Test fun reportUsesAnonymousPeersAndRelativeTime() {
        var now = 100L
        val trace = CallTrace { now }
        now = 250
        trace.event("ice-state", "private-account-uuid", "CHECKING")
        trace.event("transport-state", "private-account-uuid", "CONNECTING")
        trace.count("remote-candidate")
        val report = trace.snapshot()
        assertFalse(report.toString().contains("private-account-uuid"))
        assertEquals(150, report.getJSONArray("events").getJSONObject(0).getInt("ms"))
        assertEquals("peer-1", report.getJSONArray("events").getJSONObject(1).getString("peer"))
        assertEquals(1, report.getJSONObject("counters").getInt("remote-candidate"))
    }
    @Test fun boundedTraceKeepsLatestEventsAndSnapshotIsDetached() {
        val trace = CallTrace { 0 }
        repeat(300) { trace.event("ice-state", value = it.toString()) }
        val report = trace.snapshot()
        assertEquals(160, report.getJSONArray("events").length())
        assertEquals("140", report.getJSONArray("events").getJSONObject(0).getString("value"))
        report.getJSONArray("events").getJSONObject(0).put("value", "changed")
        assertEquals("140", trace.snapshot().getJSONArray("events").getJSONObject(0).getString("value"))
    }
}
