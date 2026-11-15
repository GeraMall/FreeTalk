package io.freetalk.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeSettingsPolicyTest {
    @Test fun bridgeRejectsOtherUsersMessagesFilesAndArbitraryUrls() {
        for (path in listOf("https://trlka.com/api/v1/me", "/v1/internal/export", "/v1/chats", "/v1/users/abc", "/v1/me/../admin", "/v1/me?token=secret", "file:///etc/passwd")) {
            assertFalse(path, NativeSettingsPolicy.allows(path, "GET"))
            assertFalse(path, NativeSettingsPolicy.allows(path, "DELETE"))
        }
        assertTrue(NativeSettingsPolicy.allows("/v1/me/sessions/11111111-1111-4111-8111-111111111111", "DELETE"))
        assertFalse(NativeSettingsPolicy.allows("/v1/me/sessions/current/all", "DELETE"))
    }
    @Test fun wallpaperCannotLoadAnExternalUrlOrScript() {
        for (value in listOf("javascript:alert(1)", "https://example.com/image.png", "data:text/html;base64,PGgxPg==")) {
            assertThrows(IllegalArgumentException::class.java) { NativeSettingsPolicy.patch(JSONObject().put("chatWallpaperDataUrl", value)) }
        }
        assertEquals("data:image/png;base64,AQ==", NativeSettingsPolicy.patch(JSONObject().put("chatWallpaperDataUrl", "data:image/png;base64,AQ==")).getString("chatWallpaperDataUrl"))
    }
    @Test fun settingsRejectUnknownFieldsOutOfRangeAndWrongTypes() {
        for (input in listOf("{\"token\":\"secret\"}", "{\"outputVolume\":-1}", "{\"screenFrameRate\":240}", "{\"echoCancellation\":\"false\"}", "{\"chatTextScale\":10}"))
            assertThrows(IllegalArgumentException::class.java) { NativeSettingsPolicy.patch(JSONObject(input)) }
        assertEquals(1.55, NativeSettingsPolicy.patch(JSONObject("{\"chatTextScale\":1.55}")).getDouble("chatTextScale"), .00001)
    }
}
