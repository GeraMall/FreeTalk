package io.freetalk.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeRoomStateTest {
    private fun joined() = JSONObject("""{"type":"joined-room","selfId":"a","roomStartedAt":123,"participants":[{"id":"a","name":"Я","isOwner":true,"muted":false},{"id":"b","name":"Друг","muted":false}],"roomChatMessages":[]}""")
    @Test fun joinedUsesServerRosterAndClock() {
        val room = NativeRoomState(); room.accept(joined())
        assertEquals("a", room.selfId); assertEquals(123L, room.startedAt); assertEquals(2, room.peers.size)
        assertTrue(room.peers.first().owner)
    }
    @Test fun muteAndOwnershipFollowServer() {
        val room = NativeRoomState(); room.accept(joined())
        room.accept(JSONObject("""{"type":"mute-changed","participantId":"b","muted":true}"""))
        room.accept(JSONObject("""{"type":"owner-changed","ownerId":"b"}"""))
        assertTrue(room.peers.last().muted); assertTrue(room.peers.last().owner); assertFalse(room.peers.first().owner)
    }
    @Test fun duplicateChatIsNotRenderedTwiceAndHistoryBounded() {
        val room = NativeRoomState()
        repeat(205) { room.accept(JSONObject().put("type", "room-chat-message").put("message", JSONObject().put("id", "$it").put("senderName", "Друг").put("text", "тест"))) }
        room.accept(JSONObject("""{"type":"room-chat-message","message":{"id":"204","senderName":"Друг","text":"тест"}}"""))
        assertEquals(200, room.messages.size); assertEquals("204", room.messages.last().id)
    }
    @Test fun leaveRemovesPeerAndResetClearsRoom() {
        val room = NativeRoomState(); room.accept(joined())
        room.accept(JSONObject("""{"type":"participant-left","participantId":"b"}""")); assertEquals(1, room.peers.size)
        room.accept(JSONObject("""{"type":"room-closed"}""")); assertTrue(room.closed)
        room.reset(); assertFalse(room.closed); assertTrue(room.peers.isEmpty()); assertEquals(0L, room.startedAt)
    }

    private fun message(id: String, text: String) = JSONObject().put("id", id).put("text", text).put("participantId", "self").put("senderName", "Me")
    @Test fun editingAndReactingDoNotMoveMessagesOrExposeRoomTokenInActivity() {
        val state = NativeRoomState()
        state.accept(JSONObject("""{"type":"joined-room","selfId":"self","participants":[],"roomChatToken":"secret","activity":{"revision":1}}"""))
        for (id in listOf("one", "two")) state.accept(JSONObject().put("type", "room-chat-message").put("message", message(id, id)))
        state.accept(JSONObject().put("type", "room-chat-updated").put("message", message("one", "edited").put("reactions", org.json.JSONArray("""[{"emoji":"❤️","userIds":["self"]}]"""))))
        assertEquals(listOf("one", "two"), state.messages.map { it.id })
        assertEquals("edited", state.messages[0].text)
        assertTrue(state.messages[0].reactions.single().mine)
        assertFalse(state.activity!!.contains("secret"))
        state.reset()
        assertNull(state.fileToken)
    }
    @Test fun fileClientRejectsUntrustedOriginAndInvalidToken() {
        assertThrows(IllegalArgumentException::class.java) { RoomFiles("https://evil.invalid", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") }
        assertThrows(IllegalArgumentException::class.java) { RoomFiles("https://freetalk.185-225-201-129.sslip.io", "bad") }
    }
}
