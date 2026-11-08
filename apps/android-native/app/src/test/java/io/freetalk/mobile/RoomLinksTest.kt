package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class RoomLinksTest {
    @Test fun onlyKnownRoomLinksCanJoinTheNativeCall() {
        val code = "ABCDEFGHJKLM"
        assertEquals(code, roomCodeFromLink("https://trlka.com/room/$code"))
        assertEquals(code, roomCodeFromLink("https://trlka.com/?room=$code"))
        assertEquals(code, roomCodeFromLink("freetalk://join/$code"))
        assertEquals(code, roomCodeFromLink(code.lowercase()))
        assertNull(roomCodeFromLink("https://evil.invalid/room/$code"))
        assertNull(roomCodeFromLink("https://trlka.com@evil.invalid/room/$code"))
        assertNull(roomCodeFromLink("not a room"))
    }
    @Test fun streamedAttachmentsStopBeforeWritingBeyondTheLimit() {
        val output = ByteArrayOutputStream()
        try {
            copyBounded(ByteArrayInputStream(ByteArray(50_000)), output, 40_000)
            fail("Oversized attachment accepted")
        } catch (_: IllegalArgumentException) { assertTrue(output.size() <= 40_000) }
    }
    @Test fun videoCoversOnlyUseKnownServices() {
        assertEquals("https://youtu.be/9aPR9UXI1kY", videoLink("Смотри https://youtu.be/9aPR9UXI1kY"))
        assertNotNull(videoLink("https://rutube.ru/video/eaa86b5c1c7588a0f972b0aadc65a7d4/"))
        assertNotNull(videoLink("https://vkvideo.ru/video-123_456"))
        assertNull(videoLink("https://youtube.com.evil.invalid/watch?v=abc"))
        assertNull(videoLink("https://user@youtube.com/watch?v=abc"))
    }
}
