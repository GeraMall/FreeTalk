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
import java.util.concurrent.ConcurrentHashMap
import android.os.Handler
import android.os.Looper
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString

/** Real foreground service + WebRTC factory/peer startup, without production accounts. */
class NativeCallStartupTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()

    @Test fun twoNativeParticipantsCompleteAudioNegotiation() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = compose.activity
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
        val a = "11111111-1111-4111-8111-111111111111"
        val b = "22222222-2222-4222-8222-222222222222"
        val left = RoomSignaling {}
        val right = RoomSignaling {}
        val main = Handler(Looper.getMainLooper())
        val counts = ConcurrentHashMap<String, Int>()
        fun wire(source: RoomSignaling, from: String, target: RoomSignaling) {
            val socket = object : WebSocket {
                override fun request() = Request.Builder().url("http://127.0.0.1/").build()
                override fun queueSize() = 0L
                override fun send(text: String): Boolean {
                    val message = JSONObject(text).put("from", from)
                    counts.merge(message.optString("type"), 1, Int::plus)
                    main.post {
                        target.onSignal?.invoke(message) ?: target.pendingSignals.add(message)
                    }
                    return true
                }
                override fun send(bytes: ByteString) = false
                override fun close(code: Int, reason: String?) = true
                override fun cancel() {}
            }
            RoomSignaling::class.java.getDeclaredField("socket").apply { isAccessible = true }.set(source, socket)
        }
        val engines = AtomicReference<List<NativeCallMedia>>(emptyList())
        val failure = AtomicReference<Throwable?>()
        val started = CountDownLatch(1)
        instrumentation.runOnMainSync {
            for ((signal, self) in listOf(left to a, right to b)) {
                signal.room.accept(JSONObject("""{"type":"joined-room","selfId":"$self","participants":[{"id":"$a","name":"Left"},{"id":"$b","name":"Right"}]}"""))
            }
            wire(left, a, right); wire(right, b, left)
            CallService.afterStart = {
                try {
                    val first = NativeCallMedia(context.applicationContext, left)
                    engines.set(listOf(first))
                    engines.set(listOf(first, NativeCallMedia(context.applicationContext, right)))
                } catch (error: Throwable) { failure.set(error) }
                finally { started.countDown() }
            }
            context.startForegroundService(Intent(context, CallService::class.java).putExtra("types", ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE))
        }
        try {
            assertTrue(started.await(15, TimeUnit.SECONDS))
            failure.get()?.let { throw AssertionError("Native media startup failed", it) }
            val pair = engines.get()
            val deadline = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < deadline &&
                !(pair[0].connections[b] == "Подключён" && pair[1].connections[a] == "Подключён")) Thread.sleep(100)
            assertTrue("No connected audio pair: left=${pair[0].connections}/${pair[0].error}; right=${pair[1].connections}/${pair[1].error}; messages=$counts",
                pair[0].connections[b] == "Подключён" && pair[1].connections[a] == "Подключён")
        } finally {
            instrumentation.runOnMainSync {
                engines.get().forEach { it.close() }
                left.dispose(); right.dispose()
                CallService.afterStart = null
                context.stopService(Intent(context, CallService::class.java))
            }
            instrumentation.waitForIdleSync()
        }
    }

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
