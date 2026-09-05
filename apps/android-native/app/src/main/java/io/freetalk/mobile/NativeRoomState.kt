package io.freetalk.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

data class RoomPeer(val id: String, val name: String, val avatar: String?, val muted: Boolean, val owner: Boolean)
data class RoomText(val id: String, val name: String, val text: String)
data class RoomReaction(val id: String, val peerId: String, val emoji: String, val at: Long)

class NativeRoomState {
    var selfId by mutableStateOf(""); private set
    var startedAt by mutableStateOf(0L); private set
    var peers by mutableStateOf(emptyList<RoomPeer>()); private set
    var messages by mutableStateOf(emptyList<RoomText>()); private set
    var reactions by mutableStateOf(emptyList<RoomReaction>()); private set
    var closed by mutableStateOf(false); private set
    fun reset() { selfId = ""; startedAt = 0; peers = emptyList(); messages = emptyList(); reactions = emptyList(); closed = false }
    private fun peer(j: JSONObject) = RoomPeer(j.getString("id"), j.optString("name"), j.optString("avatar").takeIf { it.isNotBlank() && it != "null" }, j.optBoolean("muted"), j.optBoolean("isOwner"))
    private fun text(j: JSONObject) = RoomText(j.getString("id"), j.optString("senderName"), j.optString("text"))
    fun accept(j: JSONObject) {
        when (j.optString("type")) {
            "joined-room" -> {
                selfId = j.getString("selfId")
                startedAt = j.optLong("roomStartedAt", System.currentTimeMillis())
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
            "mute-changed" -> peers = peers.map { if (it.id == j.optString("participantId")) it.copy(muted = j.optBoolean("muted")) else it }
            "owner-changed" -> peers = peers.map { it.copy(owner = it.id == j.optString("ownerId")) }
            "room-chat-message" -> { val m = text(j.getJSONObject("message")); messages = (messages.filterNot { it.id == m.id } + m).takeLast(200) }
            "reaction" -> reactions = (reactions.filter { System.currentTimeMillis() - it.at < 3000 } + RoomReaction(j.optString("id"), j.optString("participantId"), j.optString("reaction"), System.currentTimeMillis())).takeLast(24)
            "room-closed", "participant-disconnected" -> closed = true
        }
    }
}
