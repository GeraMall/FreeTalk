package io.freetalk.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class RoomHeartbeatTest {
    @Test fun sendsImmediatelyThenEveryTenSeconds() {
        val h = RoomHeartbeat(); h.start(100)
        assertEquals(RoomHeartbeat.Tick.PING, h.tick(100))
        assertEquals(RoomHeartbeat.Tick.WAIT, h.tick(10_099))
        assertEquals(RoomHeartbeat.Tick.PING, h.tick(10_100))
    }
    @Test fun replyingRoomStaysAliveBeyondServerTimeout() {
        val h = RoomHeartbeat(); h.start(0)
        for (time in 0L..300_000L step 10_000L) {
            assertEquals(RoomHeartbeat.Tick.PING, h.tick(time))
            h.acknowledge(time + 100)
        }
    }
    @Test fun missingPongExpiresOnce() {
        val h = RoomHeartbeat(); h.start(0); h.tick(0)
        assertEquals(RoomHeartbeat.Tick.EXPIRED, h.tick(30_000))
        assertEquals(RoomHeartbeat.Tick.WAIT, h.tick(40_000))
    }
    @Test fun stoppedRoomCannotSendOrBeRevivedByLatePong() {
        val h = RoomHeartbeat(); h.start(0); h.stop(); h.acknowledge(20_000)
        assertEquals(RoomHeartbeat.Tick.WAIT, h.tick(30_000))
        h.start(50_000); assertEquals(RoomHeartbeat.Tick.PING, h.tick(50_000))
    }
}
