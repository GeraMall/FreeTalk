package io.freetalk.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

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
                    compose.onNodeWithContentDescription("Вернуться к участникам").performClick()
                    compose.waitForIdle()
                    assertSame("Focus transition replaced a live renderer", renderer,
                        compose.runOnIdle { findTexture(activity.window.decorView) })
                }
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
