package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NativeMicrophoneGateTest {
    private fun frame(value: Short) = ByteBuffer.allocateDirect(960).order(ByteOrder.LITTLE_ENDIAN).apply { repeat(480) { putShort(it * 2, value) } }
    @Test fun vadCanHearSpeechAfterSilenceWithoutStoppingCapture() {
        val gate = NativeMicrophoneGate()
        assertFalse(gate.process(frame(0), 960, 1000, .015, "voice-activation", false, false, false, false))
        val speech = frame(5000)
        assertTrue(gate.process(speech, 960, 2000, .015, "voice-activation", false, false, false, false))
        assertEquals(5000, speech.getShort(0).toInt())
        assertTrue(gate.process(frame(0), 960, 2200, .015, "voice-activation", false, false, false, false))
        assertFalse(gate.process(frame(0), 960, 2500, .015, "voice-activation", false, false, false, false))
    }
    @Test fun muteAndTypingCannotLeakRawSpeechEvenWithComfortNoise() {
        val gate = NativeMicrophoneGate()
        val muted = frame(25000)
        assertFalse(gate.process(muted, 960, 1000, .015, "continuous", true, true, false, true))
        assertTrue((0 until 480).all { muted.getShort(it * 2) == 0.toShort() })
        val typing = frame(25000)
        assertFalse(gate.process(typing, 960, 1000, .015, "continuous", true, false, true, false))
        assertTrue((0 until 480).all { typing.getShort(it * 2) == 0.toShort() })
    }
    @Test fun pushToTalkRequiresTheButtonAndNoiseStaysQuiet() {
        val gate = NativeMicrophoneGate()
        assertFalse(gate.process(frame(5000), 960, 1000, .015, "push-to-talk", false, false, false, false))
        assertTrue(gate.process(frame(5000), 960, 1000, .015, "push-to-talk", true, false, false, false))
        val quiet = frame(0)
        assertFalse(gate.process(quiet, 960, 2000, .015, "push-to-talk", false, false, false, true))
        assertTrue((0 until 480).all { kotlin.math.abs(quiet.getShort(it * 2).toInt()) <= 18 })
    }
}
