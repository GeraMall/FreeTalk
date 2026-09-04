package io.freetalk.mobile

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.channels.Channel
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** One account-wide connection. Reconnects and requests a snapshot after every ready. */
internal fun chatLiveEvents(api: FreeTalkApi): Flow<JSONObject> = flow {
    val client = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    var attempt = 0
    try {
        while (currentCoroutineContext().isActive) {
            val incoming = Channel<JSONObject>(64)
            var socket: WebSocket? = null
            try {
                val token = api.realtimeToken()
                socket = client.newWebSocket(Request.Builder().url("wss://freetalk.191-44-38-60.sslip.io/api/v1/chats/realtime").build(), object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.send(JSONObject().put("type", "authenticate").put("token", token).toString())
                    }
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val event = runCatching { JSONObject(text) }.getOrNull() ?: return
                        if (incoming.trySend(event).isFailure) { webSocket.cancel(); incoming.close() }
                    }
                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { incoming.close() }
                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason); incoming.close() }
                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { incoming.close() }
                })
                val first = withTimeout(10000) { incoming.receive() }
                if (first.optString("type") != "ready") error("Authentication failed")
                attempt = 0
                emit(first)
                for (event in incoming) emit(event)
            } catch (e: TimeoutCancellationException) {
                currentCoroutineContext().ensureActive()
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { /* Retry after network/authentication failure. */ }
            finally { socket?.cancel(); incoming.cancel() }
            emit(JSONObject().put("type", "disconnected"))
            delay((1000L shl attempt.coerceAtMost(5)).coerceAtMost(30000L))
            attempt++
        }
    } finally { client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }
}
