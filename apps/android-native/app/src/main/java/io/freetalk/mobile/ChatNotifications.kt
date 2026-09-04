package io.freetalk.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject

internal class ChatNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    companion object { private val lock = Any() }
    init { manager.createNotificationChannel(NotificationChannel("messages", "Сообщения", NotificationManager.IMPORTANCE_HIGH)) }
    fun show(event: JSONObject, currentUserId: String, openChatId: String?) {
        val message = event.optJSONObject("message") ?: return
        val id = message.optString("id")
        if (id.isBlank()) return
        val preferences = context.getSharedPreferences("push_seen", Context.MODE_PRIVATE)
        synchronized(lock) {
            val seen = preferences.getStringSet(currentUserId, emptySet()).orEmpty().toMutableSet()
            if (!seen.add(id)) return
            if (seen.size > 500) seen.remove(seen.first { it != id })
            preferences.edit().putStringSet(currentUserId, seen).apply()
        }
        if (message.optString("sender_id") == currentUserId || event.optString("chatId") == openChatId) return
        if (message.optString("kind") !in listOf("text", "image")) return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = if (message.optString("kind") == "image") "Фотография" else message.optString("body").take(240)
        manager.notify(id, 1, Notification.Builder(context, "messages")
            .setSmallIcon(R.drawable.notification_message)
            .setContentTitle(message.optString("display_name", "FreeTalk"))
            .setContentText(text).setContentIntent(pending).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).build())
    }
}
