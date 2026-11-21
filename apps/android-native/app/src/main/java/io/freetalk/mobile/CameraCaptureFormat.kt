package io.freetalk.mobile

import kotlin.math.abs

internal data class CameraCaptureFormat(val width: Int, val height: Int, val minFps: Int, val maxFps: Int) {
    val fps: Int get() = 30.coerceIn(minFps.coerceAtLeast(1), maxFps.coerceAtLeast(1))
}

/** Capture near 720p without asking the camera for a format it does not advertise. */
internal fun preferredCameraFormat(formats: List<CameraCaptureFormat>): CameraCaptureFormat? =
    formats.asSequence()
        .filter { it.width > 0 && it.height > 0 && it.maxFps >= 1 && it.minFps <= it.maxFps }
        .minWithOrNull(compareBy(
            { (1280 - maxOf(it.width, it.height)).coerceAtLeast(0) + 2 * (maxOf(it.width, it.height) - 1280).coerceAtLeast(0) +
                abs(minOf(it.width, it.height) - 720) + 80 * abs(it.fps - 30) },
            { abs(maxOf(it.width, it.height).toDouble() / minOf(it.width, it.height) - 16.0 / 9.0) },
        ))
