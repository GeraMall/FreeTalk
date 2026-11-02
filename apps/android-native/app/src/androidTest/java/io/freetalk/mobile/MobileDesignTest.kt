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
        compose.activityRule.scenario.onActivity { androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK) }
        compose.waitForIdle()
        compose.onNode(hasSetTextAction() and hasText("Сообщение или /help")).performTextInput("Привет")
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
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
}
