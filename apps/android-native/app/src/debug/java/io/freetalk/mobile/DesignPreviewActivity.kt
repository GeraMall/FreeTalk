package io.freetalk.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Offline screen review. No session restore, socket, push registration or media capture. */
class DesignPreviewActivity : ComponentActivity() {
    var screen by mutableStateOf("home")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge(statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        screen = intent.getStringExtra("mode") ?: "home"
        val api = FreeTalkApi(SessionStore(this))
        val cache = MediaCache(java.io.File(cacheDir, "design-preview"))
        setContent { MaterialTheme(colorScheme = colors, typography = freeTalkTypography) {
            Surface(color = MobileDesign.background) { Content(api, cache) }
        } }
    }

    @Composable
    private fun Content(api: FreeTalkApi, cache: MediaCache) {
        val self = SignedInUser("11111111-1111-4111-8111-111111111111", "alex", "Alex", bio = "Всегда на связи")
        val friend = ChatMember("22222222-2222-4222-8222-222222222222", "Макс", null, "max")
        val chat = ChatSummary("33333333-3333-4333-8333-333333333333", "direct", null, listOf(ChatMember(self.id, self.displayName, null, self.username), friend), "Давай созвонимся вечером", "2026-11-02T12:00:00Z", null)
        val call = CallSummary("history-1", "PREVIEW", "2026-11-01T12:00:00Z", 2400, listOf(CallParticipant(friend.id, "Макс", null)))
        val friends = listOf(FriendSummary(friend.id, "max", "Макс", null, "online"))
        val data = AccountData(listOf(chat), friends, emptyList(), listOf(call), emptyList())
        var focused by remember { mutableStateOf<String?>(null) }
        var minimized by remember { mutableStateOf(false) }
        var mic by remember { mutableStateOf(false) }
        val back = { screen = "chats" }
        when (screen) {
            "login" -> BrandedAuthScreen(AuthPage.Login, "", "", {}, { _, _ -> }, { _, _, _, _ -> }, { _, _ -> }, {}, { screen = "recovery" })
            "recovery" -> PasswordRecoveryScreen(api) { screen = "login" }
            "conversation" -> NativeChatScreen(api, cache, self, chat, back, {}, { screen = "call" }, { screen = "call" }, preview = listOf(
                ChatMessage("m1", "Привет! Как дела?", friend.id, "Макс", "2026-11-02T12:00:00Z"),
                ChatMessage("m2", "Привет, всё отлично", self.id, "Alex", "2026-11-02T12:00:01Z"),
                ChatMessage("m3", "Давай созвонимся вечером", friend.id, "Макс", "2026-11-02T12:01:00Z"),
                ChatMessage("m4", "Да, я уже здесь", self.id, "Alex", "2026-11-02T12:02:00Z")))
            "bot" -> ServiceBotScreen(api, back, listOf(ServiceEntry("s1", "Я служебный бот TRLKA. Здесь появляются уведомления о звонках и обращения в поддержку.\n\n/bug — сообщить об ошибке\n/idea — предложить улучшение\n/subscription — подписка", "bot", "2026-11-02T12:00:00Z"), ServiceEntry("s2", "Звонок завершён: за пять минут никто не подключился.", "bot", "2026-11-02T12:01:00Z")))
            "settings" -> AccountSettingsScreen(api, cache, self, emptyList(), { screen = "home" }, {}, { screen = "login" })
            "call", "video" -> Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { minimized = true; screen = "home" }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Свернуть звонок") }
                    Column { Text("Комната с друзьями", fontWeight = FontWeight.SemiBold); Text("Проверяем связь…", color = MobileDesign.muted, fontSize = 11.sp) }
                }
                Text("Участники · 2 из 8", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
                CallParticipants(listOf(RoomPeer(self.id, self.displayName, null, false, true), RoomPeer(friend.id, "Макс", null, false, false)), self.id, null, screen == "video", focused, { focused = it }, Modifier.weight(1f))
                CallToolbar(mic, false, false, true, { mic = !mic }, {}, { screen = "video" }, {}, {}, {}, {}, {}, { minimized = false; screen = "home" })
            }
            else -> {
                val page = listOf("home", "chats", "friends", "history").indexOf(screen).coerceAtLeast(0)
                Scaffold(containerColor = MobileDesign.background, bottomBar = { MobileBottomNavigation(page) { screen = listOf("home", "chats", "friends", "history")[it] } }) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                        if (minimized) TextButton(onClick = { screen = "call" }, modifier = Modifier.fillMaxWidth()) { Text("Перейти к звонку", color = MobileDesign.green) }
                        AppHeader(self) { screen = "settings" }
                        when (page) {
                            0 -> HomePage(self, data, null, "", { screen = "call" }, { screen = "call" })
                            1 -> ChatsPage(self, listOf(chat), { screen = "conversation" }, {}, { screen = "bot" })
                            2 -> FriendsPage(api, self, friends, emptyList(), {}, { screen = "conversation" })
                            else -> HistoryPage(listOf(call), emptyList(), cache)
                        }
                    }
                }
            }
        }
    }
}
