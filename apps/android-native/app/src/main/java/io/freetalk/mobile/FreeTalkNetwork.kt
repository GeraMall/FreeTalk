package io.freetalk.mobile

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val API_BASE = "https://freetalk.191-44-38-60.sslip.io/api"

data class SignedInUser(
    val id: String,
    val username: String,
    val displayName: String,
    val email: String = "",
    val avatarUrl: String? = null,
)
data class SignedInSession(val user: SignedInUser, val accessToken: String, val refreshToken: String)
data class ChatMember(val id: String, val displayName: String, val avatarUrl: String?)
data class ChatSummary(
    val id: String,
    val type: String,
    val title: String?,
    val members: List<ChatMember>,
    val lastMessage: String?,
    val lastMessageAt: String?,
    val avatarUrl: String?,
) {
    fun displayTitle(currentUserId: String): String = title?.takeIf { it.isNotBlank() }
        ?: members.firstOrNull { it.id != currentUserId }?.displayName
        ?: "Чат"
}
data class FriendSummary(val id: String, val username: String, val displayName: String, val avatarUrl: String?, val presence: String)
data class CallParticipant(val userId: String?, val displayName: String, val avatarUrl: String?)
data class CallSummary(
    val id: String,
    val roomId: String,
    val startedAt: String,
    val durationSeconds: Int,
    val participants: List<CallParticipant>,
)
data class ChatMessage(
    val id: String, val body: String, val senderId: String?, val senderName: String, val createdAt: String,
    val kind: String = "text", val avatarUrl: String? = null, val expiresAt: String? = null,
    val width: Int = 0, val height: Int = 0,
)
data class AccountDevice(val id: String, val current: Boolean, val userAgent: String, val lastActiveAt: String)
data class AccountData(
    val chats: List<ChatSummary>,
    val friends: List<FriendSummary>,
    val pendingFriends: Int,
    val calls: List<CallSummary>,
    val devices: List<AccountDevice>,
)

class ApiException(val code: String, message: String, val status: Int) : IllegalStateException(message)

class FreeTalkApi(private val sessions: SessionStore) {
    val chatEvents = kotlinx.coroutines.flow.MutableSharedFlow<JSONObject>(extraBufferCapacity = 64)
    suspend fun realtimeToken(): String {
        authorizedJson("/v1/me")
        return accessToken ?: error("Требуется вход")
    }
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    private val refreshMutex = Mutex()
    var accessToken: String? = null
        private set

    suspend fun restore(): SignedInUser? {
        val refreshToken = sessions.readRefreshToken() ?: return null
        return runCatching {
            refresh(refreshToken)
            parseUser(authorizedJson("/v1/me").getJSONObject("user"))
        }.getOrElse { clearSession(); null }
    }

    suspend fun login(login: String, password: String): SignedInSession =
        acceptSession(publicJson("/v1/auth/login", JSONObject().put("login", login).put("password", password)))

    suspend fun register(email: String, username: String, displayName: String, password: String) {
        publicJson(
            "/v1/auth/register",
            JSONObject().put("email", email.trim().lowercase())
                .put("username", username.trim().removePrefix("@").lowercase())
                .put("displayName", displayName.trim()).put("password", password)
                .put("acceptedTerms", true).put("acceptedPrivacy", true),
        )
    }

    suspend fun verifyEmail(email: String, code: String): SignedInSession = acceptSession(
        publicJson(
            "/v1/auth/verify-email",
            JSONObject().put("email", email.trim().lowercase()).put("code", code.trim()),
        ),
    )

    suspend fun resendVerification(email: String) {
        publicJson("/v1/auth/resend-verification", JSONObject().put("email", email.trim().lowercase()))
    }

    suspend fun logout() {
        runCatching { authorizedJson("/v1/auth/logout", "POST", JSONObject()) }
        clearSession()
    }

    suspend fun loadAccountData(): AccountData = withContext(Dispatchers.IO) {
        val chatsJson = authorizedJson("/v1/chats").optJSONArray("chats") ?: JSONArray()
        val friendsJson = authorizedJson("/v1/friends")
        val historyJson = authorizedJson("/v1/history").optJSONArray("calls") ?: JSONArray()
        val devicesJson = authorizedJson("/v1/me/sessions").optJSONArray("sessions") ?: JSONArray()
        AccountData(
            chats = chatsJson.objects().map(::parseChat),
            friends = (friendsJson.optJSONArray("friends") ?: JSONArray()).objects().map(::parseFriend),
            pendingFriends = friendsJson.optJSONArray("pending")?.length() ?: 0,
            calls = historyJson.objects().map(::parseCall),
            devices = devicesJson.objects().map {
                AccountDevice(it.optString("id"), it.optBoolean("current"), it.optString("userAgent", "Android"), it.optString("lastActiveAt"))
            },
        )
    }

    suspend fun loadMessages(chatId: String): List<ChatMessage> {
        val array = authorizedJson("/v1/chats/$chatId/messages").optJSONArray("messages") ?: JSONArray()
        return array.objects().map(::parseMessage)
    }

    suspend fun sendMessage(chatId: String, body: String): ChatMessage {
        val json = authorizedJson("/v1/chats/$chatId/messages", "POST", JSONObject().put("body", body.trim()))
        return parseMessage(json.getJSONObject("message"))
    }

    suspend fun downloadChatImage(messageId: String, full: Boolean): ByteArray = withContext(Dispatchers.IO) {
        require(runCatching { UUID.fromString(messageId) }.isSuccess)
        val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
        val path = "/v1/messages/$messageId/image?variant=" + if (full) "full" else "thumbnail"
        fun fetch(bearer: String): ByteArray = client.newCall(
            Request.Builder().url(API_BASE + path).header("Authorization", "Bearer $bearer").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) throw ApiException("IMAGE_FAILED", "Не удалось загрузить фото (${response.code})", response.code)
            val body = response.body ?: error("Пустое изображение")
            require(body.contentType()?.type == "image") { "Сервер вернул не изображение" }
            val limit = 20 * 1024 * 1024
            require(body.contentLength() <= limit) { "Изображение слишком большое" }
            val output = java.io.ByteArrayOutputStream()
            body.byteStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= limit) { "Изображение слишком большое" }
                    output.write(buffer, 0, count)
                }
            }
            output.toByteArray()
        }
        try { fetch(token) } catch (error: ApiException) {
            if (error.status != 401) throw error
            refreshMutex.withLock {
                if (accessToken == token) refresh(sessions.readRefreshToken() ?: throw error)
            }
            fetch(accessToken ?: throw error)
        }
    }

    private suspend fun publicJson(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(API_BASE + path).post(body.toString().toRequestBody(jsonType)).build())
    }

    private suspend fun authorizedJson(path: String, method: String = "GET", body: JSONObject? = null, retry: Boolean = true): JSONObject =
        withContext(Dispatchers.IO) {
            val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
            val builder = Request.Builder().url(API_BASE + path).header("Authorization", "Bearer $token")
            if (method == "POST") builder.post((body ?: JSONObject()).toString().toRequestBody(jsonType)) else builder.get()
            try {
                execute(builder.build())
            } catch (error: ApiException) {
                if (error.status != 401 || !retry) throw error
                val refreshToken = sessions.readRefreshToken() ?: throw error
                refreshMutex.withLock { if (accessToken == token) refresh(refreshToken) }
                authorizedJson(path, method, body, false)
            }
        }

    private suspend fun refresh(refreshToken: String) {
        val session = publicJson("/v1/auth/refresh", JSONObject().put("refreshToken", refreshToken)).getJSONObject("session")
        accessToken = session.getString("accessToken")
        sessions.saveRefreshToken(session.getString("refreshToken"))
    }

    private fun acceptSession(json: JSONObject): SignedInSession {
        val session = json.getJSONObject("session")
        val user = parseUser(json.getJSONObject("user"))
        accessToken = session.getString("accessToken")
        val refreshToken = session.getString("refreshToken")
        sessions.saveRefreshToken(refreshToken)
        return SignedInSession(user, accessToken!!, refreshToken)
    }

    private fun clearSession() { accessToken = null; sessions.clear() }

    private fun execute(request: Request): JSONObject = client.newCall(request).execute().use { response ->
        val json = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrElse { JSONObject() }
        if (!response.isSuccessful) throw ApiException(
            json.optString("code", "REQUEST_FAILED"),
            json.optString("message", "Ошибка сервера (${response.code})"),
            response.code,
        )
        json
    }

    private fun parseUser(json: JSONObject) = SignedInUser(
        json.optString("id"), json.optString("username"),
        json.optString("displayName", json.optString("display_name", "Пользователь")),
        json.optString("email"), json.nullableString("avatarUrl"),
    )

    private fun parseChat(json: JSONObject): ChatSummary {
        val members = (json.optJSONArray("members") ?: JSONArray()).objects().map {
            ChatMember(it.optString("id"), it.optString("displayName", it.optString("display_name")), it.nullableString("avatarUrl"))
        }
        return ChatSummary(
            json.optString("id"), json.optString("type"), json.nullableString("title"), members,
            json.nullableString("lastMessage"), json.nullableString("lastMessageAt"), json.nullableString("avatarUrl"),
        )
    }

    private fun parseFriend(json: JSONObject) = FriendSummary(
        json.optString("id"), json.optString("username"),
        json.optString("displayName", json.optString("display_name")), json.nullableString("avatarUrl"),
        json.optString("presence", "offline"),
    )

    private fun parseCall(json: JSONObject) = CallSummary(
        json.optString("id"), json.optString("room_id", json.optString("roomId")),
        json.optString("started_at", json.optString("startedAt")),
        json.optInt("duration_seconds", json.optInt("durationSeconds")),
        (json.optJSONArray("participants") ?: JSONArray()).objects().map {
            CallParticipant(
                userId = it.nullableString("userId"),
                displayName = it.optString("displayName", "Участник"),
                avatarUrl = it.nullableString("avatarUrl"),
            )
        },
    )

    internal fun parseMessage(json: JSONObject) = ChatMessage(
        json.optString("id"), json.optString("body"), json.nullableString("sender_id"),
        json.optString("display_name", json.optString("displayName", "FreeTalk")),
        json.optString("created_at", json.optString("createdAt")),
        json.optString("kind", "text"), json.nullableString("avatar_url"), json.nullableString("expires_at"),
        json.optJSONObject("metadata")?.optInt("width") ?: 0,
        json.optJSONObject("metadata")?.optInt("height") ?: 0,
    )
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.nullableString(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

sealed interface RoomEvent {
    data object Connected : RoomEvent
    data class Created(val roomId: String) : RoomEvent
    data class Error(val message: String) : RoomEvent
    data object Disconnected : RoomEvent
}

class RoomSignaling(private val onEvent: (RoomEvent) -> Unit) {
    private val client = OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS).connectTimeout(15, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null

    fun create(roomId: String, user: SignedInUser, accessToken: String) = connect("create-room", roomId, user, accessToken)
    fun join(roomId: String, user: SignedInUser, accessToken: String) = connect("join-room", roomId, user, accessToken)

    private fun connect(action: String, roomId: String, user: SignedInUser, accessToken: String) {
        close()
        val request = Request.Builder().url("wss://freetalk.191-44-38-60.sslip.io/ws?room=$roomId&cid=${UUID.randomUUID()}").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onEvent(RoomEvent.Connected)
                webSocket.send(
                    JSONObject().put("type", action).put("roomId", roomId)
                        .put("clientId", UUID.randomUUID().toString()).put("sessionId", UUID.randomUUID().toString())
                        .put("authToken", accessToken).put("name", user.displayName).toString(),
                )
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (message.optString("type")) {
                    "room-created", "joined-room" -> onEvent(RoomEvent.Created(roomId))
                    "error" -> onEvent(RoomEvent.Error(message.optString("message", "Ошибка комнаты")))
                }
            }
            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) = onEvent(RoomEvent.Error(error.message ?: "Сеть недоступна"))
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onEvent(RoomEvent.Disconnected)
        })
    }

    fun close() { socket?.close(1000, "Выход"); socket = null }
}
