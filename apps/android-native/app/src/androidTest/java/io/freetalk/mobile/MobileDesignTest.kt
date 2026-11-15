package io.freetalk.mobile

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.toPixelMap
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
        compose.onNodeWithText("Привет! Как дела?", substring = true).assertIsDisplayed()
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
    @Test fun callChatCanBeOpenedAndTypedIntoWithoutLeavingTheCallView() {
        show("call")
        compose.onNodeWithText("Чат").performClick()
        compose.onNodeWithText("Перейти к звонку").assertIsDisplayed()
        compose.onNode(hasSetTextAction() and hasText("Написать сообщение…")).performClick().performTextInput("Пишу во время звонка")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.onNodeWithText("Перейти к звонку").performClick()
        compose.onNodeWithContentDescription("Микрофон").assertIsDisplayed()
        compose.onNodeWithText("Чат").assertIsDisplayed()
    }
    @Test fun passwordVisibilityCanBeToggled() {
        show("login")
        compose.onNodeWithContentDescription("Показать пароль").performClick()
        compose.onNodeWithContentDescription("Скрыть пароль").assertIsDisplayed().performClick()
    }
    @Test fun loginBrandStaysLegibleInLightTheme() {
        val previousTheme = MobilePreferences.theme
        try {
            compose.activity.runOnUiThread { MobilePreferences.theme = "light" }
            show("login")
            val pixels = compose.onNodeWithText("TRLKA").captureToImage().toPixelMap()
            var bright = 0
            for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
                val pixel = pixels[x, y]
                if (pixel.red > .85f && pixel.green > .85f && pixel.blue > .85f) bright++
            }
            org.junit.Assert.assertTrue("Login wordmark must remain white on its dark background", bright > pixels.width * pixels.height * .05f)
        } finally {
            compose.activity.runOnUiThread { MobilePreferences.theme = previousTheme }
        }
    }
    @Test fun groupFriendCanBeSelectedByTappingTheCheckbox() {
        show("chats")
        compose.onNodeWithContentDescription("Новый чат").performClick()
        compose.onNodeWithText("Создать группу").performClick()
        val checkbox = compose.onNode(isToggleable(), useUnmergedTree = true)
        checkbox.assertIsOff().performTouchInput { click() }
        checkbox.assertIsOn()
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
