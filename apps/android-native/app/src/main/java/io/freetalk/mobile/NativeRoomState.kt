package io.freetalk.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

data class RoomPeer(val id: String, val name: String, val avatar: String?, val muted: Boolean, val owner: Boolean, val deafened: Boolean = false)
data class RoomFile(val id: String, val name: String, val size: Long, val mime: String, val image: Boolean)
data class RoomText(val id: String, val name: String, val text: String, val participantId: String = "", val avatar: String? = null,
    val timestamp: Long = 0, val attachment: RoomFile? = null, val replyTo: String? = null,
    val reactions: List<ChatReaction> = emptyList(), val deleted: Boolean = false)
data class RoomReaction(val id: String, val peerId: String, val emoji: String, val at: Long)

class NativeRoomState {
    var selfId by mutableStateOf(""); private set
    var startedAt by mutableStateOf(0L); private set
    var peers by mutableStateOf(emptyList<RoomPeer>()); private set
    var messages by mutableStateOf(emptyList<RoomText>()); private set
    var reactions by mutableStateOf(emptyList<RoomReaction>()); private set
    var closed by mutableStateOf(false); private set
    var activity by mutableStateOf<String?>(null); private set
    var pointer by mutableStateOf<String?>(null); private set
    var fileToken: String? = null; private set
    fun reset() { selfId = ""; startedAt = 0; peers = emptyList(); messages = emptyList(); reactions = emptyList(); closed = false; activity = null; pointer = null; fileToken = null }
    private fun peer(j: JSONObject) = RoomPeer(j.getString("id"), j.optString("name"), j.optString("avatar").takeIf { it.isNotBlank() && it != "null" }, j.optBoolean("muted"), j.optBoolean("isOwner"), j.optBoolean("deafened"))
    private fun text(j: JSONObject): RoomText {
        val file = j.optJSONObject("attachment")?.let { RoomFile(it.getString("id"), it.optString("name"), it.optLong("size"), it.optString("mime"), it.optBoolean("image")) }
        val items = j.optJSONArray("reactions")
        val reactions = if (items == null) emptyList() else (0 until items.length()).map { index ->
            val entry = items.getJSONObject(index)
            val ids = entry.getJSONArray("userIds")
            ChatReaction(entry.optString("emoji"), ids.length(), (0 until ids.length()).any { ids.getString(it) == selfId })
        }
        return RoomText(j.getString("id"), j.optString("senderName"), j.optString("text"), j.optString("participantId"),
            j.optString("senderAvatar").takeIf { it.isNotBlank() && it != "null" }, j.optLong("timestamp"), file,
            j.optString("replyTo").takeIf { it.isNotBlank() && it != "null" }, reactions, j.optBoolean("deleted"))
    }
    fun accept(j: JSONObject) {
        when (j.optString("type")) {
            "joined-room" -> {
                selfId = j.getString("selfId")
                fileToken = j.optString("roomChatToken").takeIf { it.isNotBlank() }
                startedAt = j.optLong("roomStartedAt", System.currentTimeMillis())
                activity = j.optJSONObject("activity")?.toString()
                val list = j.getJSONArray("participants")
                peers = (0 until list.length()).map { peer(list.getJSONObject(it)) }
                val chat = j.optJSONArray("roomChatMessages")
                messages = if (chat == null) emptyList() else (0 until chat.length()).map { text(chat.getJSONObject(it)) }.takeLast(200)
            }
            "participant-joined", "participant-updated" -> {
                val p = peer(j.getJSONObject("participant")); peers = peers.filterNot { it.id == p.id } + p
            }
            "participants" -> { val list = j.getJSONArray("participants"); peers = (0 until list.length()).map { peer(list.getJSONObject(it)) } }
            "participant-left" -> peers = peers.filterNot { it.id == j.optString("participantId") }
            "mute-changed" -> peers = peers.map { if (it.id == j.optString("participantId")) it.copy(muted = j.optBoolean("muted"), deafened = j.optBoolean("deafened")) else it }
            "activity-state" -> activity = j.optJSONObject("activity")?.toString()
            "activity-pointer" -> pointer = j.toString()
            "owner-changed" -> peers = peers.map { it.copy(owner = it.id == j.optString("ownerId")) }
            "room-chat-message" -> { val m = text(j.getJSONObject("message")); messages = (messages.filterNot { it.id == m.id } + m).takeLast(200) }
            "room-chat-updated" -> { val m = text(j.getJSONObject("message")); messages = messages.map { if (it.id == m.id) m else it } }
            "reaction" -> reactions = (reactions.filter { System.currentTimeMillis() - it.at < 3000 } + RoomReaction(j.optString("id"), j.optString("participantId"), j.optString("reaction"), System.currentTimeMillis())).takeLast(24)
            "room-closed", "participant-disconnected" -> closed = true
        }
    }
}
