package io.freetalk.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.webrtc.VideoSink
import org.webrtc.VideoTrack
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

class NativeCameraUiTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()

    @Test fun realCameraCanStartFocusResizeStopAndStartAgainWithoutReplacingTheRendererOnFocus() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = compose.activity
        assumeTrue(activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))
        instrumentation.uiAutomation.grantRuntimePermission(activity.packageName, Manifest.permission.RECORD_AUDIO)
        instrumentation.uiAutomation.grantRuntimePermission(activity.packageName, Manifest.permission.CAMERA)
        val signal = RoomSignaling {}
        val engine = AtomicReference<NativeCallMedia>()
        val failure = AtomicReference<Throwable>()
        val serviceStarted = CountDownLatch(1)
        compose.runOnIdle {
            signal.room.accept(JSONObject("""{"type":"joined-room","selfId":"11111111-1111-4111-8111-111111111111","participants":[{"id":"11111111-1111-4111-8111-111111111111","name":"Alex"}]}"""))
            CallService.afterStart = {
                runCatching { NativeCallMedia(activity.applicationContext, signal) }
                    .onSuccess { media -> engine.set(media); activity.previewCallMedia = media; activity.screen = "video" }
                    .onFailure(failure::set)
                serviceStarted.countDown()
            }
            activity.startForegroundService(Intent(activity, CallService::class.java).putExtra("types",
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA))
        }
        try {
            assertTrue("Camera foreground service did not start", serviceStarted.await(15, TimeUnit.SECONDS))
            failure.get()?.let { throw AssertionError("Media initialization failed", it) }
            val media = checkNotNull(engine.get())
            repeat(2) { cycle ->
                compose.runOnIdle { media.startCamera() }
                compose.waitUntil(15_000) { compose.runOnIdle { media.camera || media.error.isNotEmpty() } }
                val local = compose.runOnIdle {
                    assertTrue(media.error.ifBlank { "Camera did not activate" }, media.camera)
                    checkNotNull(media.videos["self:camera"])
                }
                val firstVideoFrame = CountDownLatch(1)
                val geometry = AtomicReference<Pair<Int, Int>>(0 to 0)
                val sink = VideoSink { frame ->
                    geometry.set(frame.rotatedWidth to frame.rotatedHeight)
                    firstVideoFrame.countDown()
                }
                compose.runOnIdle { local.addSink(sink) }
                assertTrue("No frame from the native camera", firstVideoFrame.await(5, TimeUnit.SECONDS))
                compose.runOnIdle { local.removeSink(sink) }
                assertTrue("Invalid camera frame geometry ${geometry.get()}", geometry.get().let { it.first >= 320 && it.second >= 240 })
                compose.waitUntil(5_000) { compose.runOnIdle { findTexture(activity.window.decorView)?.alpha == 1f } }
                val renderer = compose.runOnIdle { findTexture(activity.window.decorView) }
                if (cycle == 0) {
                    compose.onNodeWithText("Макс").performClick()
                    assertSame("Focus transition replaced a live renderer", renderer,
                        compose.runOnIdle { findTexture(activity.window.decorView) })
                    inOtherOrientation(activity) {
                        assertSame("Rotation replaced a live renderer", renderer,
                            compose.runOnIdle { findTexture(activity.window.decorView) })
                        compose.runOnIdle { assertTrue(media.camera) }
                    }
                    compose.onNodeWithContentDescription("Вернуться к участникам").performClick()
                    assertSame("Returning to the grid replaced a live renderer", renderer,
                        compose.runOnIdle { findTexture(activity.window.decorView) })
                } else verifyScreenFocus(activity, media, local)
                compose.runOnIdle { media.stopCapture("camera") }
                compose.waitUntil(5_000) { compose.runOnIdle { findTexture(activity.window.decorView) == null } }
                compose.runOnIdle { assertFalse(media.camera); assertTrue(media.videos.isEmpty()) }
            }
        } finally {
            compose.runOnIdle {
                activity.previewCallMedia = null
                engine.get()?.close()
                signal.dispose()
                CallService.afterStart = null
                activity.stopService(Intent(activity, CallService::class.java))
            }
        }
    }

    private fun verifyScreenFocus(activity: DesignPreviewActivity, media: NativeCallMedia, track: VideoTrack) {
        // Treat live camera frames as an incoming presentation in this debug-only fixture.
        // Avoid MediaProjection consent and OS capture UI in an otherwise offline receiver test.
        @Suppress("UNCHECKED_CAST")
        val tracks = NativeCallMedia::class.java.getDeclaredField("videos\$delegate").apply { isAccessible = true }
            .get(media) as MutableState<Map<String, VideoTrack>>
        val previous = compose.runOnIdle { tracks.value }
        val geometry = AtomicReference(0 to 0)
        val sink = VideoSink { frame -> geometry.set(frame.rotatedWidth to frame.rotatedHeight) }
        compose.runOnIdle {
            track.addSink(sink)
            tracks.value = mapOf("${DesignPreviewActivity.PREVIEW_PEER_ID}:screen" to track)
            activity.screen = "screen-share"
        }
        try {
            val decor = activity.window.decorView
            compose.waitUntil(10_000) { compose.runOnIdle { findTexture(decor)?.alpha == 1f } }
            val renderer = compose.runOnIdle { checkNotNull(findTexture(decor)) }
            repeat(2) { attempt ->
                compose.onNodeWithText("Макс").performClick()
                compose.onNodeWithContentDescription("Чат во время звонка").assertIsDisplayed()
                assertFullViewportFit(decor, renderer, geometry)
                if (attempt == 0) inOtherOrientation(activity) { assertFullViewportFit(decor, renderer, geometry) }
                compose.onNodeWithContentDescription("Вернуться к участникам").performClick()
                compose.onNodeWithText("Комната с друзьями").assertIsDisplayed()
                assertSame("Returning from a presentation replaced its renderer", renderer,
                    compose.runOnIdle { findTexture(decor) })
            }
        } finally {
            compose.runOnIdle {
                tracks.value = previous
                track.removeSink(sink)
                activity.screen = "video"
            }
        }
    }

    private fun assertFullViewportFit(decor: View, renderer: TextureView, geometry: AtomicReference<Pair<Int, Int>>) {
        compose.waitUntil(6_000) {
            compose.runOnIdle {
                val (sourceWidth, sourceHeight) = geometry.get()
                val width = renderer.width
                val height = renderer.height
                sourceWidth > 0 && sourceHeight > 0 && width > 0 && height > 0 &&
                    width <= decor.width + 1 && height <= decor.height + 1 &&
                    (abs(width - decor.width) <= 2 || abs(height - decor.height) <= 2) &&
                    abs(width.toFloat() / height - sourceWidth.toFloat() / sourceHeight) < .03f
            }
        }
        assertSame("Fullscreen presentation replaced its renderer", renderer,
            compose.runOnIdle { findTexture(decor) })
    }

    private fun inOtherOrientation(activity: DesignPreviewActivity, check: () -> Unit) {
        if (activity.resources.configuration.smallestScreenWidthDp >= 600) return
        val initial = activity.resources.configuration.orientation
        val previousRequest = activity.requestedOrientation
        try {
            compose.runOnIdle {
                activity.requestedOrientation = if (initial == Configuration.ORIENTATION_LANDSCAPE)
                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            compose.waitUntil(10_000) { activity.resources.configuration.orientation != initial }
            check()
        } finally {
            compose.runOnIdle { activity.requestedOrientation = previousRequest }
        }
    }

    private fun findTexture(view: View): TextureView? {
        if (view is TextureView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findTexture(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }
}
