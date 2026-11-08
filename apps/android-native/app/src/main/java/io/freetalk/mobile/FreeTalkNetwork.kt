package io.freetalk.mobile

import kotlinx.coroutines.Dispatchers
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.MultipartBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

data class SignedInUser(
    val id: String,
    val username: String,
    val displayName: String,
    val email: String = "",
    val avatarUrl: String? = null,
    val bio: String = "",
    val coverUrl: String? = null,
)
data class SignedInSession(val user: SignedInUser, val accessToken: String, val refreshToken: String)
data class ChatMember(val id: String, val displayName: String, val avatarUrl: String?, val username: String = "")
data class ChatSummary(
    val id: String,
    val type: String,
    val title: String?,
    val members: List<ChatMember>,
    val lastMessage: String?,
    val lastMessageAt: String?,
    val avatarUrl: String?,
    val archived: Boolean = false,
    val muted: Boolean = false,
    val pinned: Boolean = false,
    val isSaved: Boolean = false,
    val unreadCount: Int = 0,
) {
    fun displayTitle(currentUserId: String): String = if (isSaved) "Избранное" else title?.takeIf { it.isNotBlank() }
        ?: members.firstOrNull { it.id != currentUserId }?.displayName
        ?: "Чат"
}
data class FriendSummary(val id: String, val username: String, val displayName: String, val avatarUrl: String?, val presence: String)
data class FriendRequestSummary(
    val id: String,
    val senderId: String,
    val recipientId: String,
    val profileId: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
    val presence: String,
)
data class ActiveCall(
    val roomId: String,
    val chatId: String?,
    val title: String,
    val memberIds: List<String>,
    val participants: List<CallParticipant>,
)
data class IncomingCall(
    val invitationId: String,
    val roomId: String,
    val inviterId: String,
    val inviterName: String,
    val inviterAvatarUrl: String?,
    val expiresAt: String,
)
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
    val filename: String = "", val mime: String = "application/octet-stream", val size: Long = 0,
    val reactions: List<ChatReaction> = emptyList(), val reply: String? = null, val deleted: Boolean = false,
)
data class ChatReaction(val emoji: String, val count: Int, val mine: Boolean)
data class AccountDevice(val id: String, val current: Boolean, val userAgent: String, val lastActiveAt: String)
data class AccountData(
    val chats: List<ChatSummary>,
    val friends: List<FriendSummary>,
    val pendingFriends: List<FriendRequestSummary>,
    val calls: List<CallSummary>,
    val devices: List<AccountDevice>,
)

class ApiException(val code: String, message: String, val status: Int) : IllegalStateException(message)

internal data class ServiceEntry(val id: String, val body: String, val author: String, val createdAt: String)

class FreeTalkApi(private val sessions: SessionStore) {
    private val linkPreviews = LinkedHashMap<String, JSONObject?>()
    suspend fun videoPreview(url: String): JSONObject? {
        synchronized(linkPreviews) { if (linkPreviews.containsKey(url)) return linkPreviews[url] }
        val result = authorizedJson("/v1/link-preview?url=" + java.net.URLEncoder.encode(url, "UTF-8")).optJSONObject("preview")
        synchronized(linkPreviews) {
            linkPreviews[url] = result
            while (linkPreviews.size > 100) linkPreviews.remove(linkPreviews.keys.first())
        }
        return result
    }
    suspend fun previewImage(key: String): ByteArray = withContext(Dispatchers.IO) {
        require(Regex("^[a-f0-9]{64}$").matches(key))
        val token = accessToken ?: error("Требуется вход")
        fun fetch(bearer: String): ByteArray = androidServers.execute("/v1/link-preview/image/$key") { it.header("Authorization", "Bearer $bearer").build() }.use { response ->
            if (!response.isSuccessful) throw ApiException("PREVIEW_FAILED", "Обложка недоступна", response.code)
            val body = response.body ?: error("Обложка недоступна")
            require(body.contentType()?.type == "image")
            val output = java.io.ByteArrayOutputStream()
            body.byteStream().use { copyBounded(it, output, 2L * 1024 * 1024) }
            output.toByteArray()
        }
        try { fetch(token) } catch (error: ApiException) {
            if (error.status != 401) throw error
            refreshMutex.withLock { if (accessToken == token) refresh(sessions.readRefreshToken() ?: throw error) }
            fetch(accessToken ?: throw error)
        }
    }
    private val messagesCache = linkedMapOf<String, List<ChatMessage>>()
    private val profileCache = linkedMapOf<String, SignedInUser>()
    internal var cachedServiceMessages by mutableStateOf<List<ServiceEntry>?>(null); private set
    @Synchronized fun cachedMessages(chatId: String): List<ChatMessage>? = messagesCache[chatId]
    @Synchronized private fun rememberMessages(chatId: String, messages: List<ChatMessage>): List<ChatMessage> {
        messagesCache.remove(chatId)
        messagesCache[chatId] = messages.takeLast(200)
        while (messagesCache.size > 12) messagesCache.remove(messagesCache.keys.first())
        return messages
    }
    val chatEvents = kotlinx.coroutines.flow.MutableSharedFlow<JSONObject>(extraBufferCapacity = 64)
    suspend fun realtimeToken(): String {
        authorizedJson("/v1/me")
        return accessToken ?: error("Требуется вход")
    }
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val refreshMutex = Mutex()
    var accessToken: String? = null
        private set
    private var currentUserId: String? = null

    suspend fun restore(): SignedInUser? {
        val refreshToken = sessions.readRefreshToken() ?: return null
        return try {
            refresh(refreshToken)
            parseUser(authorizedJson("/v1/me").getJSONObject("user")).also { currentUserId = it.id }
        } catch (error: ApiException) {
            if (error.status !in listOf(401, 403)) throw error
            clearSession()
            null
        }
    }

    suspend fun login(login: String, password: String): SignedInSession =
        acceptSession(publicJson("/v1/auth/login", JSONObject().put("login", login).put("password", password)))

    suspend fun register(email: String, username: String, displayName: String, password: String, birthDate: String) {
        publicJson(
            "/v1/auth/register",
            JSONObject().put("email", email.trim().lowercase())
                .put("username", username.trim().removePrefix("@").lowercase())
                .put("displayName", displayName.trim()).put("password", password).put("birthDate", birthDate)
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

    suspend fun registerPushToken(token: String) {
        authorizedJson("/v1/me/push-token", "POST", JSONObject().put("token", token))
    }

    suspend fun loadAccountData(): AccountData = withContext(Dispatchers.IO) {
        val chatsJson = authorizedJson("/v1/chats").optJSONArray("chats") ?: JSONArray()
        val friendsJson = authorizedJson("/v1/friends")
        val historyJson = authorizedJson("/v1/history").optJSONArray("calls") ?: JSONArray()
        val devicesJson = authorizedJson("/v1/me/sessions").optJSONArray("sessions") ?: JSONArray()
        AccountData(
            chats = chatsJson.objects().map(::parseChat),
            friends = (friendsJson.optJSONArray("friends") ?: JSONArray()).objects().map(::parseFriend),
            pendingFriends = (friendsJson.optJSONArray("pending") ?: JSONArray()).objects().map(::parseFriendRequest),
            calls = historyJson.objects().map(::parseCall),
            devices = devicesJson.objects().map {
                AccountDevice(it.optString("id"), it.optBoolean("current"), it.optString("userAgent", "Android"), it.optString("lastActiveAt"))
            },
        )
    }

    suspend fun loadMessages(chatId: String): List<ChatMessage> {
        val array = authorizedJson("/v1/chats/$chatId/messages").optJSONArray("messages") ?: JSONArray()
        return rememberMessages(chatId, array.objects().map(::parseMessage))
    }

    suspend fun sendMessage(chatId: String, body: String, replyTo: String? = null): ChatMessage {
        val json = authorizedJson("/v1/chats/$chatId/messages", "POST", JSONObject().put("body", body.trim()).apply { replyTo?.let { put("replyToMessageId", it) } })
        val sent = parseMessage(json.getJSONObject("message"))
        rememberMessages(chatId, (cachedMessages(chatId).orEmpty() + sent).distinctBy { it.id })
        return sent
    }

    suspend fun loadChats(): List<ChatSummary> =
        (authorizedJson("/v1/chats").optJSONArray("chats") ?: JSONArray()).objects().map(::parseChat)

    suspend fun savedChat(): ChatSummary {
        val id = authorizedJson("/v1/chats/saved", "POST", JSONObject()).getJSONObject("chat").getString("id")
        return loadChats().first { it.id == id }
    }

    suspend fun editMessage(messageId: String, body: String) { UUID.fromString(messageId); authorizedJson("/v1/messages/$messageId", "PATCH", JSONObject().put("body", body)) }
    suspend fun deleteMessage(messageId: String) { UUID.fromString(messageId); authorizedJson("/v1/messages/$messageId", "DELETE") }
    suspend fun react(messageId: String, emoji: String, remove: Boolean) {
        UUID.fromString(messageId)
        authorizedJson("/v1/messages/$messageId/reactions", "POST", JSONObject().put("emoji", emoji).put("remove", remove))
    }
    suspend fun forward(messageId: String, chatId: String) {
        UUID.fromString(messageId); UUID.fromString(chatId)
        authorizedJson("/v1/chats/$chatId/messages/forward", "POST", JSONObject().put("sourceMessageId", messageId))
    }
    suspend fun typing(chatId: String, active: Boolean) { UUID.fromString(chatId); authorizedJson("/v1/chats/$chatId/typing", "POST", JSONObject().put("active", active)) }
    suspend fun markRead(chatId: String, ids: List<String>) {
        UUID.fromString(chatId); if (ids.isEmpty()) return
        authorizedJson("/v1/chats/$chatId/reads", "POST", JSONObject().put("ids", JSONArray(ids.take(50))))
    }
    suspend fun readers(chatId: String, messageId: String): List<ChatReader> {
        UUID.fromString(chatId); UUID.fromString(messageId)
        return (authorizedJson("/v1/chats/$chatId/messages/$messageId/readers").optJSONArray("readers") ?: JSONArray()).objects().map {
            ChatReader(it.optString("displayName"), it.nullableString("avatarUrl"), it.optString("readAt"))
        }
    }

    suspend fun uploadAttachment(chatId: String, file: java.io.File, name: String, mime: String, image: Boolean, caption: String, replyTo: String? = null): ChatMessage = withContext(Dispatchers.IO) {
        UUID.fromString(chatId)
        val query = okhttp3.HttpUrl.Builder().scheme("https").host("unused.invalid").apply {
            if (caption.isNotBlank()) addQueryParameter("caption", caption.take(1000))
            replyTo?.let { addQueryParameter("replyToMessageId", it) }
        }.build().encodedQuery?.let { "?$it" }.orEmpty()
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart(if (image) "image" else "file", name, file.asRequestBody(mime.toMediaType())).build()
        val result = authorizedUpload("/v1/chats/$chatId/${if (image) "images" else "files"}$query", form)
        parseMessage(result.getJSONObject("message"))
    }

    suspend fun saveAttachment(messageId: String, output: java.io.OutputStream) = withContext(Dispatchers.IO) {
        UUID.fromString(messageId)
        val path = "/v1/messages/$messageId/file"
        val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
        val response = androidServers.execute(path) { it.header("Authorization", "Bearer $token").build() }
        response.use {
            if (!it.isSuccessful) throw ApiException("FILE_FAILED", "Не удалось скачать файл (${it.code})", it.code)
            it.body?.byteStream()?.use { source -> copyBounded(source, output, 30L * 1024 * 1024) } ?: error("Пустой файл")
        }
    }

    private suspend fun authorizedUpload(path: String, body: okhttp3.RequestBody): JSONObject {
        val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
        return try { execute(path) { it.header("Authorization", "Bearer $token").post(body).build() } }
        catch (error: ApiException) {
            if (error.status != 401) throw error
            refreshMutex.withLock { if (accessToken == token) refresh(sessions.readRefreshToken() ?: throw error) }
            execute(path) { it.header("Authorization", "Bearer ${accessToken ?: throw error}").post(body).build() }
        }
    }

    suspend fun manageChat(chat: ChatSummary, action: String, currentUserId: String) {
        require(!chat.isSaved)
        UUID.fromString(chat.id)
        when (action) {
            "archive" -> authorizedJson("/v1/chats/${chat.id}/archive", "PATCH", JSONObject().put("archived", !chat.archived))
            "mute", "pin" -> authorizedJson("/v1/chats/${chat.id}/preferences", "PATCH",
                JSONObject().put(if (action == "mute") "muted" else "pinned", if (action == "mute") !chat.muted else !chat.pinned))
            "delete" -> authorizedJson(if (chat.type == "group") "/v1/chats/${chat.id}/members/me" else "/v1/chats/${chat.id}", "DELETE")
            "block" -> {
                require(chat.type == "direct")
                val other = chat.members.first { it.id != currentUserId }
                UUID.fromString(other.id)
                authorizedJson("/v1/blocks/${other.id}", "POST", JSONObject())
            }
            else -> error("Неизвестное действие")
        }
        if (action in listOf("delete", "block")) synchronized(this) { messagesCache.remove(chat.id) }
    }

    internal suspend fun serviceMessages(search: String = ""): List<ServiceEntry> {
        val query = java.net.URLEncoder.encode(search.take(200), "UTF-8")
        val entries = (authorizedJson("/v1/service-chat/messages?search=$query").optJSONArray("messages") ?: JSONArray()).objects().map {
            ServiceEntry(it.optString("id"), it.optString("body"), it.optString("author"), it.optString("created_at"))
        }
        if (search.isBlank()) cachedServiceMessages = entries
        return entries
    }

    internal suspend fun sendServiceMessage(body: String, requestId: String) {
        require(body.isNotBlank() && body.length <= 4000)
        UUID.fromString(requestId)
        authorizedJson("/v1/service-chat/messages", "POST", JSONObject().put("body", body.trim())
            .put("requestId", requestId).put("version", "Android ${BuildConfig.VERSION_NAME}"))
    }

    suspend fun profile(userId: String): SignedInUser {
        UUID.fromString(userId)
        val profile = parseUser(authorizedJson("/v1/users/$userId/profile").getJSONObject("profile"))
        synchronized(this) { profileCache[userId] = profile; if (profileCache.size > 32) profileCache.remove(profileCache.keys.first()) }
        return profile
    }

    @Synchronized fun cachedProfile(userId: String) = profileCache[userId]
    suspend fun appearance(): JSONObject = authorizedJson("/v1/me/appearance").getJSONObject("appearance")
    suspend fun saveAppearance(theme: String, syncEnabled: Boolean) {
        require(theme in listOf("default", "light", "black"))
        authorizedJson("/v1/me/appearance", "PUT", JSONObject().put("theme", theme).put("syncEnabled", syncEnabled))
    }

    suspend fun updateProfile(name: String, bio: String): SignedInUser = parseUser(
        authorizedJson("/v1/me", "PATCH", JSONObject().put("displayName", name.trim()).put("bio", bio)).getJSONObject("user"),
    )

    suspend fun directChat(userId: String): ChatSummary {
        UUID.fromString(userId)
        return parseChat(authorizedJson("/v1/chats", "POST", JSONObject().put("type", "direct").put("memberIds", JSONArray().put(userId))).getJSONObject("chat"))
    }

    suspend fun forgotPassword(email: String) {
        publicJson("/v1/auth/forgot-password", JSONObject().put("email", email.trim().lowercase()).put("codeFormat", "numeric"))
    }

    suspend fun resetPassword(email: String, token: String, password: String) {
        publicJson("/v1/auth/reset-password", JSONObject().put("email", email.trim().lowercase()).put("token", token.trim()).put("password", password))
    }

    suspend fun inviteFriend(friendId: String, link: String) {
        val chat = authorizedJson("/v1/chats", "POST", JSONObject().put("type", "direct").put("memberIds", JSONArray().put(friendId))).getJSONObject("chat")
        sendMessage(chat.getString("id"), link)
    }

    suspend fun sendFriendRequest(username: String) {
        authorizedJson("/v1/friends/requests", "POST", JSONObject().put("username", username.trim().removePrefix("@").lowercase()))
    }

    suspend fun respondFriendRequest(requestId: String, action: String) {
        require(action == "accept" || action == "decline")
        authorizedJson("/v1/friends/requests/$requestId/$action", "POST", JSONObject())
    }

    suspend fun activeCall(chatId: String): ActiveCall? =
        authorizedJson("/v1/chats/$chatId/active-call").optJSONObject("call")?.let(::parseActiveCall)

    suspend fun startChatCall(chatId: String, roomId: String) {
        authorizedJson("/v1/chats/$chatId/calls", "POST", JSONObject().put("roomId", roomId))
    }

    suspend fun inviteToCall(roomId: String, userIds: List<String>) {
        authorizedJson("/v1/calls/$roomId/invitations", "POST", JSONObject().put("userIds", JSONArray(userIds)))
    }

    suspend fun respondToCall(invitationId: String, action: String): String {
        require(action == "accept" || action == "decline")
        return authorizedJson(
            "/v1/call-invitations/$invitationId/respond",
            "POST",
            JSONObject().put("action", action),
        ).getJSONObject("invitation").getString("roomId")
    }

    suspend fun downloadChatImage(messageId: String, full: Boolean): ByteArray = withContext(Dispatchers.IO) {
        require(runCatching { UUID.fromString(messageId) }.isSuccess)
        val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
        val path = "/v1/messages/$messageId/image?variant=" + if (full) "full" else "thumbnail"
        fun fetch(bearer: String): ByteArray = androidServers.execute(path) {
            it.header("Authorization", "Bearer $bearer").build()
        }.use { response ->
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
        execute(path) { it.post(body.toString().toRequestBody(jsonType)).build() }
    }

    private suspend fun authorizedJson(path: String, method: String = "GET", body: JSONObject? = null, retry: Boolean = true): JSONObject =
        withContext(Dispatchers.IO) {
            val token = accessToken ?: throw ApiException("UNAUTHORIZED", "Требуется вход", 401)
            try {
                execute(path) { builder ->
                    builder.header("Authorization", "Bearer $token")
                    if (method == "GET") builder.get() else builder.method(method, (body ?: JSONObject()).toString().toRequestBody(jsonType))
                    builder.build()
                }
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
        currentUserId = user.id
        accessToken = session.getString("accessToken")
        val refreshToken = session.getString("refreshToken")
        sessions.saveRefreshToken(refreshToken)
        return SignedInSession(user, accessToken!!, refreshToken)
    }

    private fun clearSession() {
        accessToken = null; currentUserId = null; sessions.clear()
        synchronized(linkPreviews) { linkPreviews.clear() }
        synchronized(this) { messagesCache.clear(); profileCache.clear(); cachedServiceMessages = null }
    }

    private fun execute(path: String, build: (Request.Builder) -> Request): JSONObject = androidServers.execute(path, build).use { response ->
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
        json.optString("bio"), json.nullableString("coverUrl"),
    )

    private fun parseChat(json: JSONObject): ChatSummary {
        val members = (json.optJSONArray("members") ?: JSONArray()).objects().map {
            ChatMember(it.optString("id"), it.optString("displayName", it.optString("display_name")), it.nullableString("avatarUrl"), it.optString("username"))
        }
        return ChatSummary(
            json.optString("id"), json.optString("type"), json.nullableString("title"), members,
            json.nullableString("lastMessage"), json.nullableString("lastMessageAt"), json.nullableString("avatarUrl"),
            json.optBoolean("archived"), json.optBoolean("muted"), json.optBoolean("pinned"), json.optBoolean("isSaved"), json.optInt("unreadCount"),
        )
    }

    private fun parseFriend(json: JSONObject) = FriendSummary(
        json.optString("id"), json.optString("username"),
        json.optString("displayName", json.optString("display_name")), json.nullableString("avatarUrl"),
        json.optString("presence", "offline"),
    )

    private fun parseFriendRequest(json: JSONObject) = FriendRequestSummary(
        id = json.optString("id"),
        senderId = json.optString("sender_id", json.optString("senderId")),
        recipientId = json.optString("recipient_id", json.optString("recipientId")),
        profileId = json.optString("profile_id", json.optString("profileId")),
        username = json.optString("username"),
        displayName = json.optString("display_name", json.optString("displayName", "Пользователь")),
        avatarUrl = json.nullableString("avatarUrl"),
        presence = json.optString("presence", "offline"),
    )

    private fun parseActiveCall(json: JSONObject) = ActiveCall(
        roomId = json.optString("roomId"),
        chatId = json.nullableString("chatId"),
        title = json.optString("title", "Звонок Trlka"),
        memberIds = (json.optJSONArray("memberIds") ?: JSONArray()).let { array ->
            (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
        },
        participants = (json.optJSONArray("participants") ?: JSONArray()).objects().map {
            CallParticipant(it.nullableString("userId"), it.optString("displayName", "Участник"), it.nullableString("avatarUrl"))
        },
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
        json.optString("display_name", json.optString("displayName", "Trlka")),
        json.optString("created_at", json.optString("createdAt")),
        json.optString("kind", "text"), json.nullableString("avatar_url"), json.nullableString("expires_at"),
        json.optJSONObject("metadata")?.optInt("width") ?: 0,
        json.optJSONObject("metadata")?.optInt("height") ?: 0,
        json.optJSONObject("metadata")?.optString("filename").orEmpty(),
        json.optJSONObject("metadata")?.optString("mime", "application/octet-stream") ?: "application/octet-stream",
        json.optJSONObject("metadata")?.optLong("size") ?: 0,
        parseReactions(json.optJSONArray("reactions")),
        (json.optJSONObject("reply_to") ?: json.optJSONObject("metadata")?.optJSONObject("replyTo"))?.optString("body"),
        !json.isNull("deleted_at") || json.optJSONObject("metadata")?.optBoolean("deleted") == true,
    )
    internal fun parseReactions(array: JSONArray?) = (array ?: JSONArray()).objects().map {
        val ids = it.optJSONArray("userIds") ?: JSONArray()
        ChatReaction(it.optString("emoji"), it.optInt("count", ids.length()), it.optBoolean("reactedByMe") || (0 until ids.length()).any { index -> ids.optString(index) == currentUserId })
    }
}

data class ChatReader(val name: String, val avatar: String?, val at: String)

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.nullableString(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

sealed interface RoomEvent {
    data object Connected : RoomEvent
    data class Created(val roomId: String) : RoomEvent
    data class Error(val message: String) : RoomEvent
    data object Disconnected : RoomEvent
}

class RoomSignaling(private val onEvent: (RoomEvent) -> Unit) {
    var fileOrigin: String? = null; private set
    private var connectedRoomId: String? = null
    val room = NativeRoomState()
    var onSignal: ((JSONObject) -> Unit)? = null
    val pendingSignals = mutableListOf<JSONObject>()
    fun send(message: JSONObject): Boolean = socket?.send(message.toString()) == true
    fun activity(action: JSONObject): Boolean {
        val snapshot = room.activity?.let { JSONObject(it) } ?: return false
        return send(JSONObject().put("type", "activity-action").put("revision", snapshot.optLong("revision")).put("action", action))
    }
    // Signaling expects JSON ping messages, not WebSocket control-frame pings.
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).build()
    @Volatile private var socket: WebSocket? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private val heartbeatExecutor = java.util.concurrent.Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "room-heartbeat").apply { isDaemon = true }
    }
    private var heartbeatTask: java.util.concurrent.ScheduledFuture<*>? = null
    private var heartbeat: RoomHeartbeat? = null
    private fun beginHeartbeat(webSocket: WebSocket) {
        heartbeatTask?.cancel(false)
        heartbeat?.stop()
        val watch = RoomHeartbeat().also { it.start(android.os.SystemClock.elapsedRealtime()) }
        heartbeat = watch
        heartbeatTask = heartbeatExecutor.scheduleAtFixedRate({
            if (socket !== webSocket) return@scheduleAtFixedRate
            when (watch.tick(android.os.SystemClock.elapsedRealtime())) {
                RoomHeartbeat.Tick.PING -> {
                    val queued = webSocket.send(JSONObject().put("type", "ping").put("timestamp", System.currentTimeMillis()).toString())
                    if (!queued) main.post { connectionLost(webSocket) }
                }
                RoomHeartbeat.Tick.EXPIRED -> main.post { connectionLost(webSocket) }
                RoomHeartbeat.Tick.WAIT -> Unit
            }
        }, 0, 1, TimeUnit.SECONDS)
    }
    private fun connectionLost(webSocket: WebSocket) {
        if (socket !== webSocket) return
        socket = null
        heartbeatTask?.cancel(false); heartbeatTask = null
        heartbeat?.stop(); heartbeat = null
        pendingSignals.clear()
        webSocket.cancel()
        onEvent(RoomEvent.Disconnected)
    }

    fun create(roomId: String, user: SignedInUser, accessToken: String) = connect("create-room", roomId, user, accessToken)
    fun join(roomId: String, user: SignedInUser, accessToken: String) = connect("join-room", roomId, user, accessToken)

    private fun connect(action: String, roomId: String, user: SignedInUser, accessToken: String) {
        if (!Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$").matches(roomId)) {
            onEvent(RoomEvent.Error("Проверьте код или ссылку комнаты"))
            return
        }
        if (connectedRoomId == roomId && socket != null && room.selfId.isNotEmpty()) {
            onEvent(RoomEvent.Created(roomId))
            return
        }
        close()
        room.reset()
        pendingSignals.clear()
        val socketUrl = androidServers.socketUrl("/ws?room=$roomId&cid=${UUID.randomUUID()}")
        fileOrigin = socketUrl.substringBefore("/ws").replaceFirst("wss://", "https://")
        val request = Request.Builder().url(socketUrl).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post {
                    if (socket !== webSocket) return@post
                    onEvent(RoomEvent.Connected)
                    beginHeartbeat(webSocket)
                }
                webSocket.send(
                    JSONObject().put("type", action).put("roomId", roomId)
                        .put("clientId", UUID.randomUUID().toString()).put("sessionId", UUID.randomUUID().toString())
                        .put("authToken", accessToken).put("name", user.displayName).put("avatar", user.avatarUrl)
                        .put("activityVersion", 2).put("pokerSeats", 8).put("tabletVersion", 3).put("pokerFlow", 2).put("propertyRules", 2).put("propertyRoll", 2).toString(),
                )
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                main.post {
                    if (socket !== webSocket) return@post
                    if (message.optString("type") == "pong") {
                        heartbeat?.acknowledge(android.os.SystemClock.elapsedRealtime())
                        return@post
                    }
                    room.accept(message)
                    if (onSignal != null) onSignal?.invoke(message)
                    else if (message.optString("type") in listOf("ice-config", "offer", "answer", "ice-candidate")) {
                        if (pendingSignals.size < 256) pendingSignals.add(message)
                    }
                    when (message.optString("type")) {
                        "joined-room" -> { connectedRoomId = roomId; onEvent(RoomEvent.Created(roomId)) }
                        "error" -> onEvent(RoomEvent.Error(message.optString("message", "Ошибка комнаты")))
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { main.post { connectionLost(webSocket) } }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { main.post { connectionLost(webSocket) } }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { main.post { connectionLost(webSocket) } }
        })
    }

    fun close() {
        fileOrigin = null
        connectedRoomId = null
        val previous = socket; socket = null
        heartbeatTask?.cancel(false); heartbeatTask = null
        heartbeat?.stop(); heartbeat = null
        previous?.close(1000, "Выход")
    }
    fun dispose() { close(); heartbeatExecutor.shutdownNow() }
}
