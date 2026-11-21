package io.freetalk.mobile

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class CallTileLayoutTest {
    @Test fun equalAreaTilesStayInsidePhoneTabletAndLandscapeBounds() {
        for ((width, height) in listOf(320f to 390f, 390f to 600f, 800f to 900f, 720f to 260f)) {
            for (count in 1..8) {
                val layout = CallTileLayout.calculate(width, height, count)
                assertEquals(count, layout.frames.size)
                val area = layout.frames.first().let { it.width * it.height }
                layout.frames.forEachIndexed { i, a ->
                    assertTrue(a.width > 0 && a.height > 0 && a.x >= 0 && a.y >= 0)
                    assertTrue(a.x + a.width <= width + .1f && a.y + a.height <= layout.canvasHeight + .1f)
                    assertTrue(abs(a.width * a.height - area) < 1f)
                    layout.frames.drop(i + 1).forEach { b -> assertTrue(a.x + a.width <= b.x + .1f || b.x + b.width <= a.x + .1f || a.y + a.height <= b.y + .1f || b.y + b.height <= a.y + .1f) }
                }
            }
        }
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
