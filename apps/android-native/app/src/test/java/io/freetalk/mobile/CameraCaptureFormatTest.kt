package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test

class CameraCaptureFormatTest {
    @Test fun sustained720p30WinsOverGrainyOrOverlyLargeOptions() {
        val target = CameraCaptureFormat(1280, 720, 15, 30)
        assertEquals(target, preferredCameraFormat(listOf(
            CameraCaptureFormat(640, 480, 15, 30),
            CameraCaptureFormat(1920, 1080, 15, 30),
            CameraCaptureFormat(1280, 720, 15, 15),
            target,
        )))
    }

    @Test fun slowerCameraKeepsAnAdvertisedFrameRate() {
        val best = preferredCameraFormat(listOf(
            CameraCaptureFormat(0, 0, 0, 0),
            CameraCaptureFormat(640, 480, 15, 24),
        ))
        assertEquals(24, best?.fps)
        assertNull(preferredCameraFormat(emptyList()))
    }
}
