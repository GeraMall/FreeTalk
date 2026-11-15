package io.freetalk.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
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
    var previewProfile by mutableStateOf(SignedInUser("11111111-1111-4111-8111-111111111111", "alexey_1", "Alex",
        email = "alexey@example.invalid", bio = "Всегда на связи", emailVerified = true, registeredAt = "2026-01-01T00:00:00Z"))
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge(statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        screen = intent.getStringExtra("mode") ?: "home"
        val api = FreeTalkApi(SessionStore(this))
        val cache = MediaCache(java.io.File(cacheDir, "design-preview"))
        intent.getStringExtra("theme")?.takeIf { it in listOf("default", "light", "black") }?.let { MobilePreferences.theme = it }
        setContent { MaterialTheme(colorScheme = if (screen in listOf("login", "recovery")) colors else mobileColorScheme(), typography = freeTalkTypography, shapes = freeTalkShapes) {
            Surface(color = MobileDesign.background) { Content(api, cache) }
        } }
    }

    @Composable
    private fun Content(api: FreeTalkApi, cache: MediaCache) {
        MobileSystemBars(screen in listOf("login", "recovery") || MobilePreferences.theme != "light")
        val self = previewProfile
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
            "tablet", "room-chat" -> {
                val signal = remember { RoomSignaling {}.also { signaling ->
                    signaling.room.accept(org.json.JSONObject("""{"type":"joined-room","selfId":"11111111-1111-4111-8111-111111111111","participants":[{"id":"11111111-1111-4111-8111-111111111111","name":"Alex","muted":false,"isOwner":true,"connectedAt":0}],"activity":{"revision":1,"open":true,"region":"RU","canPlayPoker":false}}"""))
                    signaling.room.accept(org.json.JSONObject("""{"type":"room-chat-message","message":{"id":"one","participantId":"11111111-1111-4111-8111-111111111111","senderName":"Alex","text":"Привет в комнате","reactions":[{"emoji":"❤️","userIds":["friend"]}]}}"""))
                    signaling.room.accept(org.json.JSONObject("""{"type":"room-chat-message","message":{"id":"two","participantId":"friend","senderName":"Макс","text":"Давай играть"}}"""))
                } }
                DisposableEffect(signal) { onDispose { signal.dispose() } }
                Box(Modifier.fillMaxSize().safeDrawingPadding().padding(8.dp)) {
                    if (screen == "tablet") NativeTablet(signal, null) { screen = "call" } else NativeRoomChat(signal)
                }
            }
            "login" -> BrandedAuthScreen(AuthPage.Login, "", "", {}, { _, _ -> }, { _, _, _, _, _, _ -> }, { _, _ -> }, {}, { screen = "recovery" })
            "recovery" -> PasswordRecoveryScreen(api) { screen = "login" }
            "web-conversation" -> {
                val avatar = "android.resource://$packageName/${R.drawable.freetalk_mascot}"
                val webSelf = self.copy(displayName = "Гера", username = "german_1", avatarUrl = avatar)
                val webChat = chat.copy(members = listOf(ChatMember(self.id, "Гера", avatar, "german_1"),
                    ChatMember(friend.id, "Алексей", avatar, "alexey_1")))
                NativeChatScreen(api, cache, webSelf, webChat, back, {}, {}, {}, preview = listOf(
                    ChatMessage("web1", "Привет! Проверяем новый интерфейс чатов?", friend.id, "Алексей", "2026-08-26T12:18:00Z", avatarUrl = avatar),
                    ChatMessage("web2", "Да. Теперь список, переписка и профиль стоят вплотную.", self.id, "Гера", "2026-08-26T12:19:00Z", avatarUrl = avatar)))
            }
            "conversation" -> Column(Modifier.fillMaxSize()) {
                if (minimized) WebTextButton(onClick = { screen = "call" }, modifier = Modifier.fillMaxWidth().statusBarsPadding()) { Text("Перейти к звонку", color = MobileDesign.green) }
                Box(Modifier.weight(1f)) { NativeChatScreen(api, cache, self, chat, back, {}, { screen = "call" }, { screen = "call" }, preview = listOf(
                ChatMessage("m1", "Привет! Как дела?", friend.id, "Макс", "2026-11-02T12:00:00Z"),
                ChatMessage("m2", "Привет, всё отлично", self.id, "Alex", "2026-11-02T12:00:01Z"),
                ChatMessage("m3", "Давай созвонимся вечером", friend.id, "Макс", "2026-11-02T12:01:00Z"),
                ChatMessage("m4", "Да, я уже здесь", self.id, "Alex", "2026-11-02T12:02:00Z"))) }
            }
            "bot" -> ServiceBotScreen(api, back, listOf(ServiceEntry("s1", "Я служебный бот TRLKA. Здесь появляются уведомления о звонках и обращения в поддержку.\n\n/bug — сообщить об ошибке\n/idea — предложить улучшение\n/subscription — подписка", "bot", "2026-11-02T12:00:00Z"), ServiceEntry("s2", "Звонок завершён: за пять минут никто не подключился.", "bot", "2026-11-02T12:01:00Z")))
            "settings", "settings-profile", "settings-audio", "settings-interface", "settings-video", "settings-devices", "settings-recording", "settings-chats", "settings-about" ->
                AccountSettingsScreen(api, cache, self, emptyList(), { screen = "home" }, { previewProfile = it }, { screen = "login" },
                    preview = true, initialTab = screen.removePrefix("settings-").takeIf { screen != "settings" })
            "call", "video" -> Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp)) {
                CallHeader("Комната с друзьями", "Проверяем связь…", "01:05",
                    onMinimize = { minimized = true; screen = "home" },
                    onChat = { minimized = true; screen = "conversation" })
                Text("Участники · 2 из 8", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
                CallParticipants(listOf(RoomPeer(self.id, self.displayName, null, false, true), RoomPeer(friend.id, "Макс", null, false, false)), self.id, null, screen == "video", focused, { focused = it }, Modifier.weight(1f))
                CallToolbar(mic, false, false, true, { mic = !mic }, {}, { screen = "video" }, {}, {}, {}, {}, {}, { minimized = false; screen = "home" })
            }
            else -> {
                val page = listOf("home", "chats", "friends", "history", "store").indexOf(screen).coerceAtLeast(0)
                Scaffold(containerColor = MobileDesign.background, bottomBar = { MobileBottomNavigation(page) { screen = listOf("home", "chats", "friends", "history", "store")[it] } }) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                        if (minimized) WebTextButton(onClick = { screen = "call" }, modifier = Modifier.fillMaxWidth()) { Text("Перейти к звонку", color = MobileDesign.green) }
                        AppHeader(self) { screen = "settings" }
                        when (page) {
                            0 -> HomePage(self, data, null, "", { screen = "call" }, { screen = "call" })
                            1 -> ChatsPage(self, listOf(chat), { screen = "conversation" }, {}, { screen = "bot" }, friends = friends)
                            2 -> FriendsPage(api, self, friends, emptyList(), {}, { screen = "conversation" })
                            4 -> StoreLockedPage()
                            else -> HistoryPage(listOf(call), emptyList(), cache)
                        }
                    }
                }
            }
        }
    }
}
