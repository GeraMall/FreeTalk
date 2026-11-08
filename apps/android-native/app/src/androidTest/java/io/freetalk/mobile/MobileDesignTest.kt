package io.freetalk.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

class MobileDesignTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()
    private fun show(name: String) { compose.activity.runOnUiThread { compose.activity.screen = name }; compose.waitForIdle() }

    @Test fun botHeaderBackAndProfileRemainAvailableAfterKeyboard() {
        show("chats")
        compose.onNodeWithText("Уведомления и помощь").performClick()
        compose.onNodeWithContentDescription("Профиль бота").assertIsDisplayed().performClick()
        compose.onNodeWithText("TRLKA · БОТ").assertIsDisplayed()
        androidx.test.espresso.Espresso.pressBack()
        compose.waitForIdle()
        compose.onNode(hasSetTextAction() and hasText("Сообщение или /help")).performClick().performTextInput("Привет")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Назад к чатам").assertIsDisplayed().performClick()
        compose.onNodeWithText("Поиск по чатам").assertIsDisplayed()
    }
    @Test fun conversationBackAndSettingsNavigation() {
        show("conversation")
        compose.onNodeWithText("Привет! Как дела?").assertIsDisplayed()
        compose.onNodeWithContentDescription("Назад").performClick()
        compose.onNodeWithText("Поиск по чатам").assertIsDisplayed()
        show("settings")
        compose.onNodeWithText("Чаты").performClick()
        compose.onNodeWithText("Размер текста").assertIsDisplayed()
        compose.onNodeWithContentDescription("Назад").performClick()
        compose.onNodeWithText("Видео и звук").assertIsDisplayed()
    }
    @Test fun callTilesExpandAndReturnAndCallCanBeMinimized() {
        show("video")
        compose.onNodeWithText("Макс").performClick()
        compose.onNodeWithContentDescription("Вернуться к участникам").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("Свернуть звонок").performClick()
        compose.onNodeWithText("Перейти к звонку").assertIsDisplayed()
        compose.onNodeWithText("Чаты").performClick()
        compose.onNodeWithText("Поиск по чатам").assertIsDisplayed()
    }
    @Test fun passwordVisibilityCanBeToggled() {
        show("login")
        compose.onNodeWithContentDescription("Показать пароль").performClick()
        compose.onNodeWithContentDescription("Скрыть пароль").assertIsDisplayed().performClick()
    }
    @Test fun roomChatHasCompactActionsWithoutReadersOrPinning() {
        show("room-chat")
        compose.onNodeWithText("Привет в комнате").performTouchInput { longClick() }
        compose.onNodeWithText("Копировать текст").assertIsDisplayed()
        compose.onNodeWithText("Изменить").assertIsDisplayed()
        compose.onNodeWithText("Закрепить").assertDoesNotExist()
        compose.onNodeWithText("Выделить").assertDoesNotExist()
    }
    @Test fun bundledTabletLoadsWithoutAccountOrNetwork() {
        show("tablet")
        val automation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
        fun hasText(node: android.view.accessibility.AccessibilityNodeInfo?, text: String): Boolean {
            if (node == null) return false
            if (node.text?.toString()?.contains(text) == true) return true
            return (0 until node.childCount).any { hasText(node.getChild(it), text) }
        }
        compose.waitUntil(20_000) { hasText(automation.rootInActiveWindow, "Шахматы") }
        org.junit.Assert.assertTrue(hasText(automation.rootInActiveWindow, "Сапёр"))
    }
}
