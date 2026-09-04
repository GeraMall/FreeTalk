package io.freetalk.mobile

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.*
import org.json.JSONObject

internal object PushRuntime {
    @Volatile var api: FreeTalkApi? = null
    @Volatile var userId: String? = null
    @Volatile var visibleChatId: String? = null
    var registration: Job? = null
    fun syncToken(context: Context, token: String) {
        context.getSharedPreferences("push", Context.MODE_PRIVATE).edit().putString("token", token).apply()
        val activeApi = api ?: return
        val activeUser = userId ?: return
        registration?.cancel()
        registration = CoroutineScope(Dispatchers.IO).launch {
            repeat(5) { attempt ->
                if (api !== activeApi || userId != activeUser) return@launch
                try {
                    activeApi.registerPushToken(token)
                    return@launch
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { delay((attempt + 1) * 5000L) }
            }
        }
    }
}

class FreeTalkMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { PushRuntime.syncToken(applicationContext, token) }
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val recipient = data["recipientId"] ?: return
        val activeUser = getSharedPreferences("push", MODE_PRIVATE).getString("userId", null)
        if (recipient != activeUser || SessionStore(this).readRefreshToken() == null) return
        val event = runCatching { JSONObject(data["event"] ?: return) }.getOrNull() ?: return
        if (event.optString("type") != "message-created") return
        val expiresAt = event.optJSONObject("message")?.optString("expires_at")?.takeIf { it.isNotBlank() && it != "null" }
        if (expiresAt != null && runCatching { java.time.Instant.parse(expiresAt).isBefore(java.time.Instant.now()) }.getOrDefault(true)) return
        ChatNotifications(applicationContext).show(event, recipient, PushRuntime.visibleChatId)
    }
}
