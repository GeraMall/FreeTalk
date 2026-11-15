package io.freetalk.mobile

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

internal object NativeSettingsStore {
    var revision by mutableStateOf(0); private set
    private var account = ""
    @Volatile private var current = JSONObject()
    @Volatile var inputLevel = 0f
    @Volatile var typingUntil = 0L
    fun load(context: Context, userId: String) {
        if (account == userId) return
        account = userId
        current = runCatching { JSONObject(context.getSharedPreferences("account-settings", Context.MODE_PRIVATE).getString(userId, "{}") ?: "{}") }.getOrElse { JSONObject() }
        revision++
    }
    fun snapshot(): JSONObject = JSONObject(current.toString())
    fun string(key: String, fallback: String = "") = current.optString(key, fallback)
    fun boolean(key: String, fallback: Boolean = true) = current.optBoolean(key, fallback)
    fun number(key: String, fallback: Double) = current.optDouble(key, fallback)
    fun markTyping() { typingUntil = android.os.SystemClock.elapsedRealtime() + 180 }
    fun save(context: Context, patch: JSONObject): JSONObject {
        val accepted = NativeSettingsPolicy.patch(patch)
        val value = snapshot()
        accepted.keys().forEach { value.put(it, accepted.get(it)) }
        current = value
        context.getSharedPreferences("account-settings", Context.MODE_PRIVATE).edit().putString(account, value.toString()).apply()
        if (accepted.has("chatTextScale")) MobilePreferences.textScale = accepted.getDouble("chatTextScale").toFloat()
        if (accepted.has("mirrorSelfVideo")) MobilePreferences.mirrorSelf = accepted.getBoolean("mirrorSelfVideo")
        MobilePreferences.shareQuality = ScreenShareQuality(
            value.optString("screenResolution", "${MobilePreferences.shareQuality.shortEdge}p").removeSuffix("p").toInt(),
            value.optInt("screenFrameRate", MobilePreferences.shareQuality.fps),
            when (value.optString("screenContentMode", MobilePreferences.shareQuality.content.name.lowercase())) {
                "text" -> ShareContent.Text; "video" -> ShareContent.Video; else -> ShareContent.Balanced
            })
        MobilePreferences.save(context)
        revision++
        return accepted
    }
    fun reset(context: Context) {
        current = JSONObject()
        context.getSharedPreferences("account-settings", Context.MODE_PRIVATE).edit().remove(account).apply()
        MobilePreferences.textScale = 1f; MobilePreferences.mirrorSelf = true; MobilePreferences.shareQuality = ScreenShareQuality()
        MobilePreferences.save(context); revision++
    }
}
