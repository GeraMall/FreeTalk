package io.freetalk.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenShareQualityTest {
    @Test fun rotatesLandscapeAndPortraitWithoutCroppingOrUpscaling() {
        val quality = ScreenShareQuality()
        assertEquals(1920 to 864, quality.dimensions(2400, 1080))
        assertEquals(864 to 1920, quality.dimensions(1080, 2400))
        assertEquals(800 to 600, quality.dimensions(800, 600))
    }

    @Test fun keepsEvenDimensionsAndFitsTabletAndSingleAppWindows() {
        assertEquals(960 to 720, ScreenShareQuality(720).dimensions(2048, 1536))
        assertEquals(1920 to 1440, ScreenShareQuality(1440).dimensions(2048, 1536))
        assertEquals(410 to 730, ScreenShareQuality().dimensions(411, 731))
    }
}
