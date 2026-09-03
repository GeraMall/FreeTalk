package io.freetalk.mobile

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

data class SignedInUser(val id: String, val username: String, val displayName: String)
data class SignedInSession(val user: SignedInUser, val accessToken: String, val refreshToken: String)

class FreeTalkApi(private val sessions: SessionStore) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    var accessToken: String? = null
        private set

    suspend fun login(login: String, password: String): SignedInSession = withContext(Dispatchers.IO) {
        val body = JSONObject().put("login", login).put("password", password)
        val request = Request.Builder()
            .url("https://freetalk.191-44-38-60.sslip.io/api/v1/auth/login")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().use { response ->
            val json = response.requireJson()
            val session = json.getJSONObject("session")
            val user = json.getJSONObject("user")
            accessToken = session.getString("accessToken")
            sessions.saveRefreshToken(session.getString("refreshToken"))
            SignedInSession(
                user = SignedInUser(
                    user.getString("id"),
                    user.getString("username"),
                    user.getString("displayName"),
                ),
                accessToken = accessToken!!,
                refreshToken = session.getString("refreshToken"),
            )
        }
    }

    private fun Response.requireJson(): JSONObject {
        val text = body?.string().orEmpty()
        val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
        if (!isSuccessful) throw IllegalStateException(json.optString("message", "Ошибка сервера ($code)"))
        return json
    }
}

sealed interface RoomEvent {
    data object Connected : RoomEvent
    data class Created(val roomId: String) : RoomEvent
    data class Error(val message: String) : RoomEvent
    data object Disconnected : RoomEvent
}

class RoomSignaling(private val onEvent: (RoomEvent) -> Unit) {
    private val client = OkHttpClient.Builder()
        .pingInterval(10, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()
    private var socket: WebSocket? = null

    fun create(roomId: String, user: SignedInUser, accessToken: String) {
        close()
        val request = Request.Builder()
            .url("wss://freetalk.191-44-38-60.sslip.io/ws?room=$roomId&cid=${UUID.randomUUID()}")
            .build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onEvent(RoomEvent.Connected)
                webSocket.send(
                    JSONObject()
                        .put("type", "create-room")
                        .put("roomId", roomId)
                        .put("clientId", UUID.randomUUID().toString())
                        .put("sessionId", UUID.randomUUID().toString())
                        .put("authToken", accessToken)
                        .put("name", user.displayName)
                        .toString(),
                )
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (message.optString("type")) {
                    "room-created", "joined-room" -> onEvent(RoomEvent.Created(roomId))
                    "error" -> onEvent(RoomEvent.Error(message.optString("message", "Ошибка комнаты")))
                }
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                onEvent(RoomEvent.Error(error.message ?: "Сеть недоступна"))
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onEvent(RoomEvent.Disconnected)
            }
        })
    }

    fun close() {
        socket?.close(1000, "Выход")
        socket = null
    }
}
