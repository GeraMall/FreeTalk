package io.freetalk.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
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
}
