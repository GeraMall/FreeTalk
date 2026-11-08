package io.freetalk.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.Looper
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Explicitly selected manual interop fixture, never part of ordinary connected tests. */
class BrowserCallInteropTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()

    @Test fun connectToRealBrowser() {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("browserInterop") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = compose.activity
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
        val self = "11111111-1111-4111-8111-111111111111"
        val browser = "22222222-2222-4222-8222-222222222222"
        val signal = RoomSignaling {}
        val main = Handler(Looper.getMainLooper())
        val outbound = LinkedBlockingQueue<String>()
        val media = AtomicReference<NativeCallMedia?>()
        val failure = AtomicReference<Throwable?>()
        val configured = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val browserPassed = AtomicBoolean(false)
        val server = ServerSocket(18898, 8, InetAddress.getByName("127.0.0.1"))
        val running = AtomicBoolean(true)
        instrumentation.runOnMainSync {
            signal.room.accept(JSONObject("""{"type":"joined-room","selfId":"$self","participants":[{"id":"$self","name":"Android"},{"id":"$browser","name":"Browser"}]}"""))
            val socket = object : WebSocket {
                override fun request() = Request.Builder().url("http://127.0.0.1/").build()
                override fun queueSize() = 0L
                override fun send(text: String): Boolean { outbound.offer(JSONObject(text).put("from", self).toString()); return true }
                override fun send(bytes: ByteString) = false
                override fun close(code: Int, reason: String?) = true
                override fun cancel() {}
            }
            RoomSignaling::class.java.getDeclaredField("socket").apply { isAccessible = true }.set(signal, socket)
        }
        val thread = Thread {
            while (running.get()) {
                try {
                    server.accept().use { client ->
                        client.soTimeout = 5000
                        val reader = client.getInputStream().bufferedReader()
                        val path = reader.readLine()?.split(" ")?.getOrNull(1) ?: "/"
                        var length = 0
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
                        }
                        require(length in 0..131072)
                        val body = CharArray(length)
                        var read = 0
                        while (read < length) { val next = reader.read(body, read, length - read); if (next < 0) break; read += next }
                        val response = when (path) {
                            "/poll" -> { val items = mutableListOf<String>(); outbound.drainTo(items); JSONArray(items.map(::JSONObject)).toString() }
                            "/message" -> {
                                val message = JSONObject(String(body)).put("from", browser)
                                main.post {
                                    signal.onSignal?.invoke(message) ?: signal.pendingSignals.add(message)
                                    if (message.optString("type") == "ice-config") configured.countDown()
                                }
                                "{}"
                            }
                            "/status" -> {
                                val snapshot = AtomicReference("{}")
                                val done = CountDownLatch(1)
                                main.post {
                                    snapshot.set(JSONObject().put("connected", media.get()?.connections?.get(browser) == "Подключён")
                                        .put("states", JSONObject(media.get()?.connections.orEmpty())).put("error", media.get()?.error.orEmpty()).toString())
                                    done.countDown()
                                }
                                done.await(3, TimeUnit.SECONDS); snapshot.get()
                            }
                            "/done" -> { browserPassed.set(JSONObject(String(body)).optBoolean("passed")); "{}" }
                            else -> "{}"
                        }.toByteArray(Charsets.UTF_8)
                        client.getOutputStream().apply {
                            write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://127.0.0.1:1420\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\nContent-Length: ${response.size}\r\n\r\n").toByteArray())
                            write(response); flush()
                        }
                        if (path == "/done") completed.countDown()
                    }
                } catch (error: Exception) { if (running.get()) failure.compareAndSet(null, error) }
            }
        }.apply { isDaemon = true; start() }
        try {
            assertTrue("Browser did not supply ICE config", configured.await(120, TimeUnit.SECONDS))
            val started = CountDownLatch(1)
            instrumentation.runOnMainSync {
                CallService.afterStart = {
                    try { media.set(NativeCallMedia(context.applicationContext, signal)) }
                    catch (error: Throwable) { failure.set(error) }
                    finally { started.countDown() }
                }
                context.startForegroundService(Intent(context, CallService::class.java).putExtra("types", ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE))
            }
            assertTrue(started.await(15, TimeUnit.SECONDS))
            failure.get()?.let { throw AssertionError("Interop startup failed", it) }
            assertTrue("Browser did not finish interop", completed.await(120, TimeUnit.SECONDS))
            assertTrue("Browser reported failure", browserPassed.get())
            assertEquals("Подключён", media.get()?.connections?.get(browser))
        } finally {
            running.set(false); server.close(); thread.join(1000)
            instrumentation.runOnMainSync {
                media.get()?.close(); signal.dispose(); CallService.afterStart = null
                context.stopService(Intent(context, CallService::class.java))
            }
        }
    }
}
