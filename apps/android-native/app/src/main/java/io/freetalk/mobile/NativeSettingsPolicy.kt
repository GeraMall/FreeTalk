package io.freetalk.mobile

import org.json.JSONObject

/** Only account settings endpoints are exposed to the bundled settings page. */
internal object NativeSettingsPolicy {
    private val uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    fun allows(path: String, method: String): Boolean = when (method) {
        "GET" -> path in setOf("/v1/me", "/v1/me/sessions", "/v1/me/passkeys", "/v1/me/appearance")
        "PUT" -> path == "/v1/me/appearance"
        "POST" -> path in setOf("/v1/me/change-password", "/v1/me/passkeys/start", "/v1/me/passkeys/finish", "/v1/auth/qr/approve")
        "DELETE" -> path == "/v1/me" || Regex("^/v1/me/(sessions|passkeys)/$uuid$").matches(path)
        else -> false
    }
    private val booleans = setOf("autoUpdate", "noiseSuppression", "autoGainControl", "echoCancellation", "echoDucking",
        "typingAttenuation", "comfortNoise", "screenAudioByDefault", "screenAdaptiveQuality", "cameraPreviewAlways", "mirrorSelfVideo",
        "participantJoinedSound", "participantDisconnectedSound", "recordingStartSound", "microphoneEnabledSound", "microphoneDisabledSound",
        "incomingCallSound", "messageNotificationSound", "recordingAskDirectory", "recordingShowParticipantNames", "recordingAddTimestamp", "recordingIncludeSharedVideo")
    private val enums = mapOf("transmissionMode" to setOf("voice-activation", "push-to-talk", "continuous"),
        "participantCardStyle" to setOf("classic", "avatar-glass"), "participantCardDecoration" to setOf("none", "japan", "china", "britain", "kazakhstan", "russia"),
        "chatMessageStyle" to setOf("bubbles", "compact"), "chatWallpaperFit" to setOf("cover", "contain"),
        "cameraBackgroundMode" to setOf("none", "blur", "custom"), "screenResolution" to setOf("720p", "1080p", "1440p"),
        "screenContentMode" to setOf("text", "balanced", "video"))
    private val numbers = mapOf("vadThreshold" to (.01.. .12), "outputVolume" to (0.0..2.0), "echoDuckingLevel" to (0.0..1.0),
        "chatTextScale" to (.85..1.55))
    private val strings = setOf("inputDeviceId", "outputDeviceId", "cameraDeviceId", "pushToTalkKey", "recordingDirectory")
    fun patch(input: JSONObject): JSONObject {
        val result = JSONObject()
        input.keys().forEach { key ->
            val value = input.get(key)
            when {
                key in booleans -> { require(value is Boolean); result.put(key, value) }
                key in enums -> { require(value is String && value in enums.getValue(key)); result.put(key, value) }
                key in numbers -> { require(value is Number && value.toDouble().isFinite() && value.toDouble() in numbers.getValue(key)); result.put(key, value) }
                key == "screenFrameRate" -> { require(value is Number && value.toInt() in setOf(15, 30, 60)); result.put(key, value.toInt()) }
                key in strings -> { require(value is String && value.length <= 4096); result.put(key, value) }
                key in setOf("chatWallpaperDataUrl", "cameraBackgroundDataUrl") -> {
                    require(value is String && (value.isEmpty() || Regex("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$").matches(value)) && value.length <= 6_000_000)
                    result.put(key, value)
                }
                key == "profileChangeTimestamps" -> Unit // The API enforces the account limit.
                else -> throw IllegalArgumentException("Неподдерживаемая настройка")
            }
        }
        return result
    }
}
