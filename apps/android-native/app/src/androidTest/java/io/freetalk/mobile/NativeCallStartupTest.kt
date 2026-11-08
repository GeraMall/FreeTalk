package io.freetalk.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real foreground service + WebRTC factory/peer startup, without production accounts. */
class NativeCallStartupTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()

    @Test fun microphoneCallCanStartCloseAndStartAgainWithoutBluetoothPermission() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = compose.activity
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
        repeat(3) {
            val completed = CountDownLatch(1)
            val failure = AtomicReference<Throwable?>()
            val engine = AtomicReference<NativeCallMedia?>()
            val signal = RoomSignaling {}
            instrumentation.runOnMainSync {
                signal.room.accept(JSONObject("""{"type":"joined-room","selfId":"11111111-1111-4111-8111-111111111111","participants":[{"id":"11111111-1111-4111-8111-111111111111","name":"Local"},{"id":"22222222-2222-4222-8222-222222222222","name":"Remote"}]}"""))
                CallService.afterStart = {
                    try { engine.set(NativeCallMedia(context.applicationContext, signal)) }
                    catch (error: Throwable) { failure.set(error) }
                    finally { completed.countDown() }
                }
                context.startForegroundService(Intent(context, CallService::class.java).putExtra("types", ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE))
            }
            try {
                assertTrue("Call service did not start", completed.await(15, TimeUnit.SECONDS))
                failure.get()?.let { throw AssertionError("Native media startup failed", it) }
                assertNotNull("Missing native call engine", engine.get())
                instrumentation.runOnMainSync {
                    engine.get()!!.changeMuted(true)
                    engine.get()!!.changeMuted(false)
                }
                Thread.sleep(750)
            } finally {
                instrumentation.runOnMainSync {
                    engine.get()?.close()
                    signal.dispose()
                    CallService.afterStart = null
                    context.stopService(Intent(context, CallService::class.java))
                }
                instrumentation.waitForIdleSync()
            }
        }
    }
}
