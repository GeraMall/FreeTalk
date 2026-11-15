package io.freetalk.mobile

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/** Soft gating edits PCM before WebRTC, so VAD never stops the capture it listens to. */
internal class NativeMicrophoneGate {
    var lastSpeechAt = Long.MIN_VALUE / 2; private set
    var level = 0f; private set
    private var noise = 0x13579
    fun process(buffer: ByteBuffer, bytes: Int, now: Long, threshold: Double, mode: String,
        held: Boolean, muted: Boolean, typing: Boolean, comfortNoise: Boolean): Boolean {
        val data = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val length = minOf(bytes, data.capacity()).coerceAtLeast(0) / 2 * 2
        var peak = 0
        for (index in 0 until length step 2) peak = maxOf(peak, abs(data.getShort(index).toInt()))
        level = (peak / 32768f).coerceIn(0f, 1f)
        if (level > threshold) lastSpeechAt = now
        val open = !muted && !typing && when (mode) {
            "continuous" -> true
            "push-to-talk" -> held
            else -> now - lastSpeechAt < 400
        }
        if (!open) for (index in 0 until length step 2) {
            val value = if (!muted && comfortNoise) { noise = noise * 1664525 + 1013904223; (noise.ushr(16) % 37 - 18).toShort() } else 0.toShort()
            data.putShort(index, value)
        }
        return open
    }
}
