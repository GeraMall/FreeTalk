package io.freetalk.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SharedSettingsTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()
    private fun show(name: String) { compose.activity.runOnUiThread { compose.activity.screen = name }; compose.waitForIdle() }

    @Test fun allWebSettingsSectionsAreAvailableAndCanBeReturnedFrom() {
        show("settings")
        for ((label, heading) in listOf("Аудио" to "Режим передачи", "Профиль" to "Контактные данные",
            "Интерфейс" to "Цветовая тема", "Видео и звуки" to "Демонстрация экрана", "Устройства" to "Микрофон",
            "Запись" to "Локальное хранилище записей", "Чаты" to "Размер текста сообщений", "О приложении" to "Trlka")) {
            SharedSettingsUi.click(label)
            SharedSettingsUi.wait(heading)
            SharedSettingsUi.back()
            SharedSettingsUi.wait("Выберите раздел")
        }
    }
    @Test fun profileDraftCanBeEditedWithKeyboardAndSavedThroughTheNativeBridge() {
        show("settings-profile")
        SharedSettingsUi.click("Редактировать профиль")
        SharedSettingsUi.enter("Alex", "Android Profile")
        SharedSettingsUi.closeKeyboard()
        SharedSettingsUi.click("Готово")
        compose.waitUntil(10_000) { compose.activity.previewProfile.displayName == "Android Profile" }
        compose.onNodeWithText("Добрый вечер,\nAndroid Profile").assertIsDisplayed()
    }

    @Test fun qrShortcutCanBeHiddenWithoutLosingTheSettingsScanner() {
        val activity = compose.activity
        val saved = MobilePreferences.showQrShortcut
        val selector = "document.querySelector('[role=switch][aria-label^=\"Кнопка QR\"]')"
        try {
            compose.runOnIdle {
                MobilePreferences.showQrShortcut = true
                MobilePreferences.save(activity)
            }
            show("home")
            compose.onNodeWithContentDescription("Сканировать QR для входа").assertIsDisplayed()
            show("settings-interface")
            compose.waitUntil(20_000) { SharedSettingsUi.evaluate("Boolean($selector)") == "true" }
            assertEquals("true", SharedSettingsUi.evaluate("$selector.click(); true"))
            compose.waitUntil(5_000) {
                !activity.getSharedPreferences("mobile-design", android.content.Context.MODE_PRIVATE)
                    .getBoolean("showQrShortcut", true)
            }
            show("home")
            compose.onNodeWithContentDescription("Сканировать QR для входа").assertDoesNotExist()
            show("settings")
            SharedSettingsUi.click("Сканировать QR для входа")
            compose.onNodeWithText("Наведите камеру на QR-код на экране компьютера.").assertIsDisplayed()
        } finally {
            compose.runOnIdle {
                MobilePreferences.showQrShortcut = saved
                MobilePreferences.save(activity)
            }
        }
    }
}
