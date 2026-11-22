package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test

class CallTileLayoutTest {
    @Test fun matchingTilesStayInsidePhoneTabletAndLandscapeBounds() {
        for ((width, height) in listOf(320f to 390f, 390f to 600f, 800f to 900f, 720f to 260f)) {
            for (count in 1..8) {
                val layout = CallTileLayout.calculate(width, height, count)
                assertEquals(count, layout.frames.size)
                val first = layout.frames.first()
                layout.frames.forEachIndexed { i, a ->
                    assertTrue(a.width > 0 && a.height > 0 && a.x >= 0 && a.y >= 0)
                    assertTrue(a.x + a.width <= width + .1f && a.y + a.height <= layout.canvasHeight + .1f)
                    assertEquals(first.width, a.width, .01f)
                    assertEquals(first.height, a.height, .01f)
                    layout.frames.drop(i + 1).forEach { b -> assertTrue(a.x + a.width <= b.x + .1f || b.x + b.width <= a.x + .1f || a.y + a.height <= b.y + .1f || b.y + b.height <= a.y + .1f) }
                }
                layout.frames.groupBy { it.y }.values.forEach { row ->
                    assertEquals(width / 2f, (row.first().x + row.last().x + row.last().width) / 2f, .1f)
                }
            }
        }
    }

    @Test fun shortLandscapeScrollsWithoutClippingTheLastEqualSizedTile() {
        val layout = CallTileLayout.calculate(720f, 160f, 8)
        assertTrue(layout.canvasHeight > 160f)
        val last = layout.frames.last()
        assertEquals(layout.canvasHeight, last.y + last.height, .1f)
        assertEquals(layout.frames.first().width, last.width, .01f)
        assertEquals(layout.frames.first().height, last.height, .01f)
    }

    @Test fun emptyVideoLayoutKeepsAnEmptyViewport() {
        val layout = CallTileLayout.calculate(390f, 480f, 0)
        assertTrue(layout.frames.isEmpty())
        assertEquals(480f, layout.canvasHeight, .1f)
    }

    @Test fun focusedScreenEndsEvenWhenTheSameParticipantStillHasCamera() {
        val peer = RoomPeer("remote", "Remote", null, false, false)
        val focus = CallFocus(peer.id, screen = true)
        assertTrue(focus.isAvailable(listOf(peer), "local", setOf("remote:screen", "remote:camera")))
        assertFalse(focus.isAvailable(listOf(peer), "local", setOf("remote:camera")))
    }
    @Test fun twoPeopleSplitPortraitCanvasEvenly() {
        val frames = CallTileLayout.calculate(390f, 600f, 2).frames
        assertEquals(2, frames.size)
        assertEquals(390f, frames[0].width, .1f)
        assertEquals(295f, frames[0].height, .1f)
        assertEquals(305f, frames[1].y, .1f)
    }

    @Test fun audioTilesUseTabletWidthAndCenterTheFinalRow() {
        val frames = CallTileLayout.audio(1024f, 620f, 4).frames
        assertEquals(frames[0].y, frames[2].y)
        assertEquals(512f, frames[3].x + frames[3].width / 2, .1f)
        assertTrue(frames[3].y > frames[2].y)
        assertTrue(frames[3].y + frames[3].height < 620f)
    }

    @Test fun zoomedPreviewStaysInBoundsAfterRotatingToLandscape() {
        for ((w, h) in listOf(320f to 540f, 700f to 105f, 1024f to 680f)) {
            val preview = CallTileLayout.preview(w, h, 2f, -5000f, 5000f)
            assertTrue(preview.x > 0 && preview.y > 0)
            assertTrue(preview.x + preview.width <= w && preview.y + preview.height <= h)
        }
    }
}
