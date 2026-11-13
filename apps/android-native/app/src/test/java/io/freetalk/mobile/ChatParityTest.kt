package io.freetalk.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatParityTest {
    private val remote = JSONObject("""{"url":"https://static.klipy.com/example.gif?size=md","attribution":{"provider":"KLIPY","pageUrl":"https://klipy.com/gifs/example"}}""")

    @Test fun privateGifsUseOnlyTheirAssetId() {
        val id = "2b60e85e-e448-4405-acb4-2fa15be5cc52"
        val json = JSONObject("""{"assetId":"$id","url":"https://untrusted.invalid/file.gif","attribution":{"provider":"TRLKA"}}""")
        val parsed = parseChatGif(json)!!
        assertEquals(id, parsed.assetId)
        assertNull(parsed.url)
        assertNull(parsed.previewUrl)
        assertNull(parseChatGif(json.put("assetId", "../not-an-asset")))
    }

    @Test fun publicGifKeepsItsRenditionAndValidatesItsProvider() {
        val parsed = parseChatGif(remote)!!
        assertEquals(remote.getString("url"), parsed.url)
        assertEquals("https://klipy.com/gifs/example", parsed.attributionUrl)
        assertEquals(parsed.url, parseChatGif(remote.put("previewUrl", "https://bad.invalid/file.gif"))!!.previewUrl)
        assertNull(parseChatGif(remote.put("url", "https://user@static.klipy.com/file.gif")))
        assertNull(parseChatGif(remote.put("url", "https://upload.wikimedia.org/file.gif")))
    }

    @Test fun callEndingUpdatesOnlyTheIntendedFields() {
        val row = ChatMessage("id", "Call", "me", "User", "date", kind = "call", callRoomId = "FIRST")
        val ended = row.updatedBy(JSONObject("""{"metadata":{"ended":true}}"""))
        assertEquals("FIRST", ended.callRoomId)
        assertTrue(ended.callEnded)
        assertEquals("Call", ended.body)
        assertTrue(ended.updatedBy(JSONObject("""{"body":"Updated"}""")).callEnded)
    }
}
