package io.freetalk.mobile

// Uses monotonic time, so changing the phone clock cannot expire a healthy room.
internal class RoomHeartbeat(private val intervalMs: Long = 10_000, private val timeoutMs: Long = 30_000) {
    enum class Tick { WAIT, PING, EXPIRED }
    private var lastReply = 0L
    private var nextPing = 0L
    private var active = false
    @Synchronized fun start(now: Long) { active = true; lastReply = now; nextPing = now }
    @Synchronized fun stop() { active = false }
    @Synchronized fun acknowledge(now: Long) { if (active) lastReply = now }
    @Synchronized fun tick(now: Long): Tick {
        if (!active) return Tick.WAIT
        if (now - lastReply >= timeoutMs) { active = false; return Tick.EXPIRED }
        if (now >= nextPing) { nextPing = now + intervalMs; return Tick.PING }
        return Tick.WAIT
    }
}
