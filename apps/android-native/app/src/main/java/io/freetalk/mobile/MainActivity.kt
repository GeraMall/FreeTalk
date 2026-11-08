package io.freetalk.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.runtime.saveable.rememberSaveable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PeopleOutline
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.rememberUpdatedState
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import coil.compose.AsyncImage
import java.security.SecureRandom
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        MobilePreferences.load(this)
        val api = FreeTalkApi(SessionStore(this))
        val cache = MediaCache(this).also { it.trim() }
        setContent { FreeTalkNativeApp(api, cache) }
    }
}

internal val colors = darkColorScheme(
    primary = Color(0xFF8DA6DC), background = Color(0xFF040B14),
    surface = Color(0xFF101E2E), surfaceVariant = Color(0xFF1A2C48),
    outline = Color(0xFF29384E), secondary = Color(0xFF8DA6DC), onSurfaceVariant = Color(0xFF9AABC1),
    onPrimary = Color(0xFF02101A), onBackground = Color(0xFFF4F8FF), onSurface = Color(0xFFF4F8FF),
)
private val muted get() = MobileDesign.muted
private val good = Color(0xFF55EFB7)
private val danger = Color(0xFFFF8096)
private val cyanBlueGradient = Brush.linearGradient(
    listOf(Color(0xFF8DA6DC), Color(0xFF8DA6DC), Color(0xFF4B7FFF)),
)
private val appBackground get() = Brush.verticalGradient(listOf(MobileDesign.background, MobileDesign.background))

internal enum class AuthPage { Login, Register, Verify }

@Composable
private fun FreeTalkNativeApp(api: FreeTalkApi, cache: MediaCache) {
    val appContext = LocalContext.current.applicationContext
    var user by remember { mutableStateOf<SignedInUser?>(null) }
    var restoring by remember { mutableStateOf(true) }
    var restoreError by remember { mutableStateOf<String?>(null) }
    var restoreAttempt by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("") }
    var authPage by remember { mutableStateOf(AuthPage.Login) }
    var verificationEmail by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(restoreAttempt) {
        restoring = true
        restoreError = null
        try { user = api.restore() }
        catch (error: kotlinx.coroutines.CancellationException) { throw error }
        catch (_: Exception) { restoreError = "Не удалось подключиться к TRLKA. Ваш вход сохранён." }
        finally { restoring = false }
    }

    val activeColors = if (user == null) colors else mobileColorScheme()
    MobileSystemBars(user == null || MobilePreferences.theme != "light")
    MaterialTheme(colorScheme = activeColors, typography = freeTalkTypography) {
        Surface(Modifier.fillMaxSize(), color = activeColors.background) {
            when {
                restoring -> BrandedStartupScreen()
                restoreError != null -> Column(
                    Modifier.fillMaxSize().background(Color(0xFF060C14)).safeDrawingPadding().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    MobileText(restoreError.orEmpty(), color = Color(0xFF9AABC1))
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { restoreAttempt++ }) { MobileText("Повторить") }
                }
                user == null && recovery -> PasswordRecoveryScreen(api) { recovery = false }
                user == null -> BrandedAuthScreen(
                    page = authPage,
                    status = status,
                    verificationEmail = verificationEmail,
                    onPage = { authPage = it; status = "" },
                    onRecovery = { recovery = true },
                    onLogin = { login, password ->
                        status = "Входим…"
                        scope.launch {
                            runCatching { api.login(login, password) }
                                .onSuccess { user = it.user; status = "" }
                                .onFailure {
                                    if (it is ApiException && it.code == "EMAIL_NOT_VERIFIED" && login.contains('@')) {
                                        verificationEmail = login
                                        authPage = AuthPage.Verify
                                    }
                                    status = it.message ?: "Не удалось войти"
                                }
                        }
                    },
                    onRegister = { email, username, name, password, birthDate ->
                        status = "Создаём аккаунт…"
                        scope.launch {
                            runCatching { api.register(email, username, name, password, birthDate) }
                                .onSuccess { verificationEmail = email; authPage = AuthPage.Verify; status = "Код отправлен на почту" }
                                .onFailure { status = it.message ?: "Не удалось зарегистрироваться" }
                        }
                    },
                    onVerify = { email, code ->
                        status = "Проверяем код…"
                        scope.launch {
                            runCatching { api.verifyEmail(email, code) }
                                .onSuccess { user = it.user; status = "" }
                                .onFailure { status = it.message ?: "Код не принят" }
                        }
                    },
                    onResend = { email ->
                        scope.launch {
                            runCatching { api.resendVerification(email) }
                                .onSuccess { status = "Новое письмо отправлено" }
                                .onFailure { status = it.message ?: "Не удалось отправить код" }
                        }
                    },
                )
                else -> NativeShell(
                    api = api, cache = cache, user = user!!,
                    onLogout = {
                        appContext.getSharedPreferences("push", android.content.Context.MODE_PRIVATE).edit().remove("userId").apply()
                        appContext.getSystemService(android.app.NotificationManager::class.java).cancelAll()
                        PushRuntime.registration?.cancel()
                        PushRuntime.api = null
                        PushRuntime.userId = null
                        scope.launch { api.logout(); user = null; authPage = AuthPage.Login; status = "" }
                    },
                )
            }
        }
    }
}

@Composable
private fun LoadingScreen(label: String) {
    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = colors.primary)
            MobileText(label, color = muted, modifier = Modifier.padding(top = 16.dp))
        }
    }
}


@Composable
private fun NativeShell(api: FreeTalkApi, cache: MediaCache, user: SignedInUser, onLogout: () -> Unit) {
    val nativeContext = LocalContext.current
    val appearance = remember(user.id) { NativeAppearance(nativeContext.applicationContext) }
    val appearanceLifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(appearance) { onDispose { appearance.close() } }
    LaunchedEffect(user.id, appearanceLifecycle) {
        appearanceLifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { appearance.refresh(api); delay(20_000) }
        }
    }
    var page by rememberSaveable { mutableStateOf(0) }
    var profile by remember(user) { mutableStateOf(user) }
    var settingsOpen by remember { mutableStateOf(false) }
    var serviceOpen by remember { mutableStateOf(false) }
    var serviceUnread by remember { mutableStateOf(0) }
    val botRead = remember(user.id) { nativeContext.getSharedPreferences("service-read", android.content.Context.MODE_PRIVATE) }
    val markServiceRead: (List<ServiceEntry>) -> Unit = { entries ->
        val latest = entries.filter { it.author == "bot" }.maxOfOrNull {
            runCatching { java.time.Instant.parse(it.createdAt).toEpochMilli() }.getOrDefault(0)
        } ?: 0
        if (latest > botRead.getLong(user.id, 0)) botRead.edit().putLong(user.id, latest).apply()
        serviceUnread = 0
    }
    var callExpanded by remember { mutableStateOf(true) }
    var callQuality by remember { mutableStateOf("connecting") }
    var data by remember { mutableStateOf<AccountData?>(null) }
    var error by remember { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(true) }
    var roomStatus by remember { mutableStateOf("") }
    var roomId by remember { mutableStateOf<String?>(null) }
    var activeChat by remember { mutableStateOf<ChatSummary?>(null) }
    var incomingCall by remember { mutableStateOf<IncomingCall?>(null) }
    var incomingCallBusy by remember { mutableStateOf(false) }
    var pendingCallInvitees by remember { mutableStateOf<List<String>>(emptyList()) }
    var loadRunning by remember { mutableStateOf(false) }
    var chatActionRunning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val load: () -> Unit = {
        if (!loadRunning) {
          loadRunning = true
          if (data == null) refreshing = true
          scope.launch {
            runCatching { api.loadAccountData() }
                .onSuccess { data = it; error = "" }
                .onFailure { error = it.message ?: "Не удалось загрузить данные" }
            refreshing = false
            loadRunning = false
          }
        }
        Unit
    }
    val signaling = remember {
        RoomSignaling { event ->
            mainHandler.post {
                when (event) {
                    RoomEvent.Connected -> roomStatus = "Сигналинг подключён"
                    is RoomEvent.Created -> {
                        roomId = event.roomId
                        callExpanded = true
                        roomStatus = "Комната создана"
                        val invitees = pendingCallInvitees
                        pendingCallInvitees = emptyList()
                        if (invitees.isNotEmpty()) scope.launch {
                            var lastFailure: Throwable? = null
                            repeat(3) { attempt ->
                                delay(350L + attempt * 450L)
                                val result = runCatching { api.inviteToCall(event.roomId, invitees) }
                                if (result.isSuccess) return@launch
                                lastFailure = result.exceptionOrNull()
                            }
                            error = lastFailure?.message ?: "Не удалось позвонить участникам чата"
                        }
                    }
                    is RoomEvent.Error -> roomStatus = event.message
                    RoomEvent.Disconnected -> {
                        roomId = null
                        roomStatus = ""
                        error = "Связь с комнатой потеряна. Создайте новую комнату или войдите снова."
                    }
                }
            }
        }
    }
    androidx.compose.runtime.DisposableEffect(signaling) {
        onDispose { signaling.dispose() }
    }
    LaunchedEffect(user.id) { load() }
    val notificationContext = LocalContext.current
    androidx.compose.runtime.DisposableEffect(user.id) {
        PushRuntime.api = api
        PushRuntime.userId = user.id
        notificationContext.getSharedPreferences("push", android.content.Context.MODE_PRIVATE).edit().putString("userId", user.id).apply()
        onDispose {
            PushRuntime.registration?.cancel()
            PushRuntime.api = null
            PushRuntime.userId = null
            PushRuntime.visibleChatId = null
        }
    }
    val notifications = remember(user.id) { ChatNotifications(notificationContext) }
    val readingChatId = if (!settingsOpen && !serviceOpen && (roomId == null || !callExpanded)) activeChat?.id else null
    val readingService = serviceOpen && !settingsOpen && (roomId == null || !callExpanded)
    val latestChat by rememberUpdatedState(readingChatId)
    val latestLoad by rememberUpdatedState(load)
    val accountLifecycle = LocalLifecycleOwner.current.lifecycle
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(user.id) {
        if (android.os.Build.VERSION.SDK_INT >= 33) notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }
    LaunchedEffect(user.id, accountLifecycle, roomId != null) {
        accountLifecycle.repeatOnLifecycle(if (roomId != null) Lifecycle.State.CREATED else Lifecycle.State.STARTED) {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (PushRuntime.userId == user.id) PushRuntime.syncToken(notificationContext.applicationContext, token)
            }
            chatLiveEvents(api).collect { event ->
                api.chatEvents.emit(event)
                when (event.optString("type")) {
                    "presence-updated" -> data = data?.copy(friends = data!!.friends.map {
                        if (it.id == event.optString("userId")) it.copy(presence = event.optString("status", "offline")) else it
                    })
                    "message-created" -> {
                        val chatId = event.optString("chatId")
                        val target = data?.chats?.firstOrNull { it.id == chatId }
                        if (target?.archived != true && target?.muted != true) notifications.show(event, user.id, latestChat)
                        val message = event.optJSONObject("message")
                        if (message != null && target != null) {
                            val incoming = api.parseMessage(message)
                            data = data?.copy(chats = data!!.chats.map { if (it.id != chatId) it else it.copy(
                                lastMessage = incoming.body, lastMessageAt = incoming.createdAt,
                                unreadCount = if (latestChat == chatId || incoming.senderId == user.id) 0 else it.unreadCount + 1,
                            ) })
                        } else latestLoad()
                    }
                    "ready", "chat-updated", "history-cleared" -> latestLoad()
                    "incoming-call" -> {
                        val inviter = event.optJSONObject("inviter") ?: org.json.JSONObject()
                        incomingCall = IncomingCall(
                            invitationId = event.optString("invitationId"),
                            roomId = event.optString("roomId"),
                            inviterId = inviter.optString("id"),
                            inviterName = inviter.optString("displayName", "Входящий звонок"),
                            inviterAvatarUrl = inviter.optString("avatarUrl").takeIf { it.isNotBlank() },
                            expiresAt = event.optString("expiresAt"),
                        )
                    }
                    "call-invitation-resolved" -> if (event.optString("invitationId") == incomingCall?.invitationId) incomingCall = null
                }
            }
        }
    }
    LaunchedEffect(user.id, accountLifecycle, readingService) {
        accountLifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                runCatching { api.serviceMessages() }.onSuccess { entries ->
                    if (readingService) markServiceRead(entries) else {
                        val readAt = botRead.getLong(user.id, 0)
                        serviceUnread = entries.count { it.author == "bot" && runCatching { java.time.Instant.parse(it.createdAt).toEpochMilli() }.getOrDefault(0) > readAt }
                    }
                }
                delay(15_000)
            }
        }
    }
    androidx.compose.runtime.DisposableEffect(readingChatId, accountLifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            PushRuntime.visibleChatId = if (event == Lifecycle.Event.ON_START || accountLifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) readingChatId else null
        }
        accountLifecycle.addObserver(observer)
        PushRuntime.visibleChatId = if (accountLifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) readingChatId else null
        onDispose { accountLifecycle.removeObserver(observer); PushRuntime.visibleChatId = null }
    }

    Box(Modifier.fillMaxSize()) {
      Column(Modifier.fillMaxSize()) {
        if (roomId != null && !callExpanded) {
            val indicator = when (callQuality) { "good" -> MobileDesign.green; "weak" -> Color(0xFFE6BC62); "poor" -> MobileDesign.red; else -> MobileDesign.muted }
            Row(Modifier.fillMaxWidth().background(indicator.copy(alpha = .15f)).statusBarsPadding()
                .clickable { callExpanded = true }.padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Call, null, Modifier.size(18.dp), tint = indicator)
                MobileText("Перейти к звонку", Modifier.padding(start = 8.dp), color = indicator, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Box(Modifier.weight(1f).then(if (roomId != null && !callExpanded) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier)) {
    if (settingsOpen) AccountSettingsScreen(api, cache, profile, data?.devices.orEmpty(), { settingsOpen = false }, { profile = it }, onLogout, appearance)
    else if (serviceOpen) ServiceBotScreen(api, { serviceOpen = false }, onRead = { if (readingService && accountLifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) markServiceRead(it) })
    else if (activeChat != null) {
        val chat = activeChat!!
        NativeChatScreen(
            api, cache, user, chat,
            onBack = { activeChat = null },
            onChanged = load,
            onStartCall = {
                scope.launch {
                    roomStatus = "Открываем звонок…"
                    runCatching { api.activeCall(chat.id) }.onSuccess { active ->
                        if (active != null) api.accessToken?.let { signaling.join(active.roomId, user, it) }
                        else {
                            val code = generateRoomCode()
                            runCatching { api.startChatCall(chat.id, code) }
                                .onSuccess {
                                    pendingCallInvitees = chat.members.map { it.id }.filter { it != user.id }
                                    api.accessToken?.let { signaling.create(code, user, it) }
                                }
                                .onFailure { error = it.message ?: "Не удалось начать звонок" }
                        }
                    }.onFailure { error = it.message ?: "Не удалось проверить звонок" }
                }
            },
            onJoinCall = { code -> roomStatus = "Подключаемся…"; api.accessToken?.let { signaling.join(code, user, it) } },
            reading = readingChatId == chat.id,
        )
    }
    else Scaffold(
        modifier = Modifier.background(appBackground),
        containerColor = Color.Transparent,
        bottomBar = {
            MobileBottomNavigation(page) { page = it }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            AppHeader(profile) { settingsOpen = true }
            if (error.isNotBlank()) ErrorCard(error, load)
            when {
                refreshing && data == null -> LoadingScreen("Загружаем Trlka…")
                page == 0 -> HomePage(
                    user = profile, data = data, roomId = roomId, status = roomStatus,
                    onCreateRoom = {
                        val code = generateRoomCode(); roomStatus = "Создаём комнату…"
                        api.accessToken?.let { signaling.create(code, user, it) }
                    },
                    onJoinRoom = { rawCode ->
                        val code = normalizeRoomCode(rawCode)
                        roomStatus = "Подключаемся…"
                        api.accessToken?.let { signaling.join(code, user, it) }
                    },
                )
                page == 1 -> ChatsPage(profile, data?.chats.orEmpty(), activeChat = { activeChat = it }, onRefresh = load, onService = { serviceOpen = true }, friends = data?.friends.orEmpty(), onNewChat = { id -> scope.launch { runCatching { api.directChat(id) }.onSuccess { activeChat = it; load() }.onFailure { error = it.message ?: "Не удалось открыть чат" } } }, onJoinLink = { link -> api.accessToken?.let { signaling.join(normalizeRoomCode(link), profile, it) } },
                    serviceUnread = serviceUnread,
                    onSaved = { if (!chatActionRunning) {
                        chatActionRunning = true
                        scope.launch {
                            try { activeChat = data?.chats?.firstOrNull { it.isSaved } ?: api.savedChat(); load() }
                            catch (e: Exception) { error = e.message ?: "Не удалось открыть избранное" }
                            finally { chatActionRunning = false }
                        }
                    } },
                    onChatAction = { chat, action -> if (!chatActionRunning) {
                        chatActionRunning = true
                        scope.launch {
                            try {
                                api.manageChat(chat, action, user.id)
                                data = data?.copy(chats = api.loadChats())
                                if (action in listOf("delete", "block") && activeChat?.id == chat.id) activeChat = null
                            } catch (e: Exception) { error = e.message ?: "Не удалось выполнить действие" }
                            finally { chatActionRunning = false }
                        }
                    } },
                )
                page == 2 -> FriendsPage(api, profile, data?.friends.orEmpty(), data?.pendingFriends.orEmpty(), load, onChat = { activeChat = it })
                else -> HistoryPage(data?.calls.orEmpty(), data?.devices.orEmpty(), cache)
            }
        }
    }
        }
      }
      if (roomId != null) NativeRoomScreen(profile, roomId!!, roomStatus, signaling, api, data?.chats.orEmpty(), data?.friends.orEmpty(),
        onLeave = { signaling.close(); roomId = null; roomStatus = ""; load() },
        expanded = callExpanded, onMinimize = { callExpanded = false }, onQuality = { callQuality = it })
    }
    incomingCall?.let { call -> IncomingCallDialog(call, incomingCallBusy, onAccept = {
        incomingCallBusy = true
        scope.launch {
            runCatching { api.respondToCall(call.invitationId, "accept") }
                .onSuccess { acceptedRoom -> incomingCall = null; api.accessToken?.let { signaling.join(acceptedRoom, user, it) } }
                .onFailure { error = it.message ?: "Звонок уже недоступен"; incomingCall = null }
            incomingCallBusy = false
        }
    }, onDecline = {
        incomingCallBusy = true
        scope.launch { runCatching { api.respondToCall(call.invitationId, "decline") }; incomingCall = null; incomingCallBusy = false }
    }) }
}

@Composable
private fun IncomingCallDialog(call: IncomingCall, busy: Boolean, onAccept: () -> Unit, onDecline: () -> Unit) {
    AlertDialog(
        onDismissRequest = {},
        containerColor = Color(0xFF101E2E),
        title = { MobileText("Входящий звонок") },
        text = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(50.dp).clip(CircleShape).background(Color(0xFF2C416D)), contentAlignment = Alignment.Center) {
                    if (call.inviterAvatarUrl != null) AsyncImage(call.inviterAvatarUrl, call.inviterName, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    else MobileText(call.inviterName.take(1).uppercase(), color = colors.primary, fontWeight = FontWeight.Bold)
                }
                Column(Modifier.padding(start = 14.dp)) {
                    MobileText(call.inviterName, localize = false, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    MobileText("приглашает вас в разговор", color = muted, fontSize = 13.sp)
                }
            }
        },
        confirmButton = { Button(onClick = onAccept, enabled = !busy) { MobileText("Принять") } },
        dismissButton = { OutlinedButton(onClick = onDecline, enabled = !busy) { MobileText("Отклонить") } },
    )
}


@Composable
internal fun AppHeader(user: SignedInUser, onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(MobileDesign.background).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.freetalk_mascot), null, Modifier.size(28.dp))
        MobileText("TRLKA", fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(start = 8.dp))
        Box(Modifier.size(44.dp).clickable(onClickLabel = "Настройки", onClick = onSettings), contentAlignment = Alignment.Center) { MobileAvatar(user.displayName, user.avatarUrl, 36.dp) }
    }
}

@Composable
private fun ErrorCard(message: String, retry: () -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(bottom = 12.dp), color = Color(0xFF35141E), shape = RoundedCornerShape(14.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            MobileText(message, color = danger, modifier = Modifier.weight(1f))
            TextButton(onClick = retry) { MobileText("Повторить") }
        }
    }
}

@Composable
internal fun HomePage(
    user: SignedInUser,
    data: AccountData?,
    roomId: String?,
    status: String,
    onCreateRoom: () -> Unit,
    onJoinRoom: (String) -> Unit,
) {
    var roomCode by remember { mutableStateOf("") }
    val recentCalls = data?.calls.orEmpty().take(4)
    LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
                    .background(Brush.linearGradient(listOf(Color(0xEE071D2D), Color(0xED0A1C38), Color(0xEF03101E))))
                    .border(1.dp, Color(0x55376A8E), RoundedCornerShape(22.dp)),
            ) {
                Image(
                    painter = painterResource(R.drawable.freetalk_mascot), contentDescription = null,
                    modifier = Modifier.align(Alignment.CenterEnd).size(225.dp).graphicsLayer(alpha = 0.12f, rotationZ = -7f),
                    contentScale = ContentScale.Fit,
                )
                Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp)) {
                    MobileText(
                        "СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!", color = colors.primary,
                        fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp,
                    )
                    MobileText(
                        "Добрый вечер,\n${user.displayName}", fontSize = 30.sp, lineHeight = 35.4.sp,
                        fontWeight = FontWeight.Bold, letterSpacing = (-1.53).sp, modifier = Modifier.padding(top = 24.dp),
                    )
                    MobileText(
                        "Создайте приватную комнату или войдите по приглашению.",
                        color = Color(0xFFAEBCCE), fontSize = 14.sp, lineHeight = 21.sp,
                        modifier = Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 24.dp),
                    )
                    Box(
                        Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(11.dp))
                            .background(cyanBlueGradient).clickable(onClick = onCreateRoom),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.MeetingRoom, null, tint = Color(0xFF031018), modifier = Modifier.size(27.dp))
                            MobileText("Создать комнату", color = Color(0xFF031018), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.padding(start = 10.dp))
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            roomCode, { roomCode = it }, placeholder = { MobileText("Код или ссылка комнаты", color = Color(0xFF61758D)) },
                            singleLine = true, modifier = Modifier.weight(1f).height(58.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                                unfocusedBorderColor = Color(0xFF29384E), focusedBorderColor = colors.primary,
                                unfocusedContainerColor = Color(0xFF030C18), focusedContainerColor = Color(0xFF030C18),
                            ),
                        )
                        Box(
                            Modifier.padding(start = 8.dp).size(58.dp).clip(RoundedCornerShape(13.dp))
                                .background(Color(0xB9051220)).border(1.dp, Color(0x553D9CAB), RoundedCornerShape(13.dp))
                                .clickable(enabled = roomCode.isNotBlank()) { onJoinRoom(roomCode) },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Войти", tint = if (roomCode.isBlank()) muted else colors.primary) }
                    }
                    if (roomId != null) MobileText("Комната: $roomId", color = good, modifier = Modifier.padding(top = 12.dp))
                    if (status.isNotBlank()) MobileText(status, color = muted, fontSize = 13.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Column {
                    MobileText("ВАШИ ЗВОНКИ", color = colors.primary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
                    MobileText("Недавние комнаты", fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp, modifier = Modifier.padding(top = 5.dp))
                }
                MobileText("Последние ${recentCalls.size}", color = muted, fontSize = 11.sp)
            }
        }
        if (recentCalls.isEmpty()) {
            item { EmptyState("Недавних комнат пока нет", "Создайте первую комнату — она появится здесь") }
        } else {
            items(recentCalls, key = { it.id }) { call ->
                RecentRoomCard(call, user.id, onCreateRoom)
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun RecentRoomCard(call: CallSummary, currentUserId: String, onCreateAgain: () -> Unit) {
    val others = call.participants.filter { it.userId != currentUserId }
    val visible = (if (others.isNotEmpty()) others else call.participants).take(3)
    val title = when (others.size) {
        0 -> "Приватная комната"
        1 -> "Комната с ${others.first().displayName}"
        else -> "Групповой звонок · ${call.participants.size}"
    }
    Surface(
        Modifier.fillMaxWidth(), color = Color(0xD9030C18), shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x332F6B8D)),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Overlay full-size circles instead of squeezing children into a Row.
                // Reserve the entire stack width so the title never covers an avatar.
                Box(Modifier.width((34 + 22 * (visible.size - 1).coerceAtLeast(0)).dp).height(34.dp)) {
                    visible.forEachIndexed { index, participant ->
                        Box(
                            Modifier.offset(x = (index * 22).dp).size(34.dp).clip(CircleShape)
                                .background(Color(0xFF2C416D)),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (participant.avatarUrl != null) {
                                AsyncImage(
                                    model = participant.avatarUrl, contentDescription = participant.displayName,
                                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                                )
                            } else MobileText(participant.displayName.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Column(Modifier.weight(1f).padding(start = 13.dp)) {
                    MobileText(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    MobileText("${formatCallDate(call.startedAt)} · ${formatDuration(call.durationSeconds)}", color = muted, fontSize = 11.sp)
                }
            }
            OutlinedButton(
                onClick = onCreateAgain, modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(36.dp),
                shape = RoundedCornerShape(11.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x668DA6DC)),
            ) {
                Icon(Icons.Outlined.Call, null, modifier = Modifier.size(19.dp))
                MobileText("Создать снова", fontSize = 12.sp, fontWeight = FontWeight.Normal, color = muted, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun ChatsPage(user: SignedInUser, chats: List<ChatSummary>, activeChat: (ChatSummary) -> Unit, onRefresh: () -> Unit, onService: () -> Unit,
    friends: List<FriendSummary> = emptyList(), onNewChat: (String) -> Unit = {}, onJoinLink: (String) -> Unit = {},
    onSaved: () -> Unit = {}, onChatAction: (ChatSummary, String) -> Unit = { _, _ -> }, serviceUnread: Int = 0) {
    var query by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf(false) }
    var inviteCode by remember { mutableStateOf("") }
    var archived by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<ChatSummary?>(null) }
    var confirm by remember { mutableStateOf<Pair<ChatSummary, String>?>(null) }
    val shown = chats.filter { !it.isSaved && it.archived == archived && it.displayTitle(user.id).contains(query, true) }
        .sortedWith(compareByDescending<ChatSummary> { it.pinned }.thenByDescending { it.lastMessageAt.orEmpty() })
    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            MobileText(if (archived) "Архив" else "Чаты", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { archived = !archived }) { Icon(Icons.Outlined.Archive, "Архив", tint = if (archived) MobileDesign.accent else MobileDesign.muted) }
            IconButton(onClick = onSaved) { Icon(Icons.Outlined.Bookmark, "Избранное", tint = Color(0xFFE4C778)) }
            IconButton(onClick = { create = true }) { Icon(Icons.Outlined.Add, "Новый чат") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MobileSearch(query, { query = it }, "Поиск по чатам", Modifier.weight(1f))
            IconButton(onClick = { invite = true }, modifier = Modifier.background(MobileDesign.incoming, RoundedCornerShape(12.dp))) { Icon(Icons.Outlined.Link, "Войти по приглашению") }
        }
        LazyColumn(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!archived && "TRLKA".contains(query, true)) item {
                Row(Modifier.fillMaxWidth().clickable(onClick = onService).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    MobileAvatar("TRLKA", null, 44.dp, bot = true)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) { MobileText("TRLKA", fontWeight = FontWeight.SemiBold); MobileText("Уведомления и помощь", fontSize = 12.sp, color = muted) }
                    if (serviceUnread > 0) androidx.compose.material3.Badge { MobileText(serviceUnread.coerceAtMost(99).toString(), localize = false) }
                }
            }
            items(shown, key = { it.id }) { chat ->
                Row(Modifier.fillMaxWidth().combinedClickable(onClick = { activeChat(chat) }, onLongClick = { target = chat }).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    MobileAvatar(chat.displayTitle(user.id), chat.avatarUrl ?: chat.members.firstOrNull { it.id != user.id }?.avatarUrl, 44.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        MobileText(chat.displayTitle(user.id), localize = chat.isSaved, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        MobileText(chat.lastMessage ?: "Сообщений пока нет", fontSize = 12.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        MobileText(mobileMessageTime(chat.lastMessageAt.orEmpty()), fontSize = 10.sp, color = muted)
                        if (chat.unreadCount > 0) androidx.compose.material3.Badge { MobileText(chat.unreadCount.coerceAtMost(99).toString()) }
                        else if (chat.pinned) Icon(Icons.Outlined.PushPin, "Закреплён", Modifier.size(13.dp), tint = MobileDesign.muted)
                    }
                }
            }
        }
    }
    target?.let { chat -> ModalBottomSheet(onDismissRequest = { target = null }, containerColor = MobileDesign.canvas) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            MobileText(chat.displayTitle(user.id), localize = chat.isSaved, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            listOf("archive" to if (chat.archived) "Вернуть из архива" else "В архив",
                "pin" to if (chat.pinned) "Открепить" else "Закрепить",
                "mute" to if (chat.muted) "Включить уведомления" else "Отключить уведомления",
                "delete" to if (chat.type == "group") "Покинуть группу" else "Удалить чат",
            ).plus(if (chat.type == "direct") listOf("block" to "Заблокировать") else emptyList()).forEach { (action, label) ->
                TextButton(onClick = {
                    target = null
                    if (action in listOf("delete", "block")) confirm = chat to action else onChatAction(chat, action)
                }, modifier = Modifier.fillMaxWidth()) { MobileText(label, color = if (action in listOf("delete", "block")) MobileDesign.red else MobileDesign.accent) }
            }
        }
    } }
    confirm?.let { (chat, action) -> AlertDialog(onDismissRequest = { confirm = null },
        title = { MobileText(if (action == "block") "Заблокировать пользователя?" else if (chat.type == "group") "Покинуть группу?" else "Удалить чат?") },
        text = { MobileText(chat.displayTitle(user.id)) },
        confirmButton = { TextButton(onClick = { confirm = null; onChatAction(chat, action) }) { MobileText("Подтвердить", color = MobileDesign.red) } },
        dismissButton = { TextButton(onClick = { confirm = null }) { MobileText("Отмена") } },
    ) }
    if (create) ModalBottomSheet(onDismissRequest = { create = false }, containerColor = MobileDesign.canvas) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MobileText("Новый чат", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            if (friends.isEmpty()) MobileText("Добавьте друзей, чтобы начать переписку.", color = MobileDesign.muted)
            friends.forEach { friend -> TextButton(onClick = { create = false; onNewChat(friend.id) }) { MobileAvatar(friend.displayName, friend.avatarUrl); MobileText(friend.displayName, localize = false, modifier = Modifier.padding(start = 12.dp)) } }
            Spacer(Modifier.height(20.dp))
        }
    }
    if (invite) AlertDialog(onDismissRequest = { invite = false }, title = { MobileText("Войти по приглашению") },
        text = { OutlinedTextField(inviteCode, { inviteCode = it }, label = { MobileText("Код или ссылка комнаты") }) },
        confirmButton = { TextButton(enabled = inviteCode.isNotBlank(), onClick = { invite = false; onJoinLink(inviteCode) }) { MobileText("Войти") } },
        dismissButton = { TextButton(onClick = { invite = false }) { MobileText("Отмена") } })
}

@Composable
internal fun FriendsPage(api: FreeTalkApi, user: SignedInUser, friends: List<FriendSummary>, pending: List<FriendRequestSummary>, onRefresh: () -> Unit, onChat: (ChatSummary) -> Unit) {
    var username by remember { mutableStateOf("") }
    var busyId by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val incoming = pending.filter { it.recipientId == user.id }
    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { MobileText("Друзья", fontSize = 26.sp, fontWeight = FontWeight.Bold); if (incoming.isNotEmpty()) MobileText("Новых запросов: ${incoming.size}", color = colors.primary) }
            TextButton(onClick = onRefresh) { MobileText("Обновить") }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(username, { username = it.take(32) }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { MobileText("Ник пользователя") }, prefix = { MobileText("@") })
            Button(onClick = {
                val value = username
                busyId = "send"
                scope.launch {
                    runCatching { api.sendFriendRequest(value) }.onSuccess { feedback = "Заявка отправлена"; username = ""; onRefresh() }.onFailure { feedback = it.message ?: "Не удалось отправить заявку" }
                    busyId = null
                }
            }, enabled = username.isNotBlank() && busyId == null, modifier = Modifier.padding(start = 8.dp)) { Icon(Icons.Outlined.PersonAdd, null) }
        }
        if (feedback.isNotBlank()) MobileText(feedback, color = colors.primary, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 18.dp)) {
            if (incoming.isNotEmpty()) item { SectionTitle("Входящие заявки") }
            items(incoming, key = { "request:${it.id}" }) { request ->
                Surface(Modifier.fillMaxWidth(), color = Color(0xFF101E2E), shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF174052))) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0xFF2C416D)), contentAlignment = Alignment.Center) {
                                if (request.avatarUrl != null) AsyncImage(request.avatarUrl, request.displayName, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                else MobileText(request.displayName.take(1).uppercase(), color = colors.primary)
                            }
                            Column(Modifier.padding(start = 12.dp)) { MobileText(request.displayName, localize = false, fontWeight = FontWeight.Bold); MobileText("@${request.username}", color = muted, fontSize = 12.sp) }
                        }
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { busyId = request.id; scope.launch { runCatching { api.respondFriendRequest(request.id, "accept") }.onSuccess { onRefresh() }.onFailure { feedback = it.message ?: "Заявка недоступна" }; busyId = null } }, enabled = busyId == null, modifier = Modifier.weight(1f)) { MobileText("Принять") }
                            OutlinedButton(onClick = { busyId = request.id; scope.launch { runCatching { api.respondFriendRequest(request.id, "decline") }.onSuccess { onRefresh() }.onFailure { feedback = it.message ?: "Заявка недоступна" }; busyId = null } }, enabled = busyId == null, modifier = Modifier.weight(1f)) { MobileText("Отклонить") }
                        }
                    }
                }
            }
            item { SectionTitle("Ваши друзья") }
            if (friends.isEmpty()) item { EmptyState("Список пуст", "Добавленные друзья появятся здесь") }
            items(friends, key = { it.id }) { friend ->
                val online = friend.presence != "offline"
                ListCard(
                    friend.displayName, "@${friend.username} · ${if (online) "В сети" else "Не в сети"}",
                    friend.displayName.take(1), imageUrl = friend.avatarUrl, online = online,
                ) { scope.launch { runCatching { api.directChat(friend.id) }.onSuccess(onChat).onFailure { feedback = it.message ?: "Не удалось открыть чат" } } }
            }
        }
    }
}

@Composable
internal fun HistoryPage(calls: List<CallSummary>, devices: List<AccountDevice>, cache: MediaCache) {
    var cacheBytes by remember { mutableLongStateOf(0) }
    val cacheScope = rememberCoroutineScope()
    LaunchedEffect(cache) { cacheBytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.sizeBytes() } }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { MobileText("История", fontSize = 26.sp, fontWeight = FontWeight.Bold) }
        if (calls.isEmpty()) item { EmptyState("Звонков пока нет", "Завершённые разговоры появятся здесь") }
        items(calls, key = { it.id }) { call ->
            ListCard(
                call.participants.joinToString { it.displayName }.ifBlank { "Звонок" },
                formatDuration(call.durationSeconds), "☎",
                imageUrl = call.participants.firstOrNull()?.avatarUrl,
            )
        }
        item { SectionTitle("Устройства (${devices.size})") }
        items(devices, key = { it.id }) { device ->
            ListCard(if (device.current) "Это устройство" else device.userAgent.take(42), if (device.current) "Текущая сессия" else "Подключено к аккаунту", "▣", online = device.current)
        }
        item {
            SectionTitle("Хранилище")
            Surface(Modifier.fillMaxWidth(), color = colors.surface, shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.padding(16.dp)) {
                    MobileText("Кэш изображений: ${formatBytes(cacheBytes)}", fontWeight = FontWeight.SemiBold)
                    MobileText("Лимит 384 МБ. Старые файлы удаляются автоматически.", color = muted, fontSize = 13.sp)
                    OutlinedButton(onClick = { cacheScope.launch { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.clear() }; cacheBytes = 0 } }, modifier = Modifier.padding(top = 10.dp)) { MobileText("Очистить кэш") }
                }
            }
        }
    }
}


@Composable
private fun ListCard(
    title: String,
    subtitle: String,
    initial: String,
    imageUrl: String? = null,
    online: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val modifier = if (onClick != null) Modifier.fillMaxWidth().clickable(onClick = onClick) else Modifier.fillMaxWidth()
    Surface(modifier, color = colors.surface, shape = RoundedCornerShape(16.dp)) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(Color(0xFF2C416D))
                    .border(1.dp, Color(0x553D9CAB), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (imageUrl != null) {
                    AsyncImage(model = imageUrl, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else MobileText(initial, color = colors.primary, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                MobileText(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MobileText(subtitle, color = if (online) good else muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun EmptyState(title: String, subtitle: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 30.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { MobileText(title, fontWeight = FontWeight.Bold); MobileText(subtitle, color = muted, fontSize = 13.sp) }
    }
}

@Composable
private fun SectionTitle(title: String) {
    MobileText(title.uppercase(), color = muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
    HorizontalDivider(color = Color(0xFF112638))
}

private fun generateRoomCode(): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val random = SecureRandom()
    return buildString { repeat(12) { append(alphabet[random.nextInt(alphabet.length)]) } }
}

private fun normalizeRoomCode(value: String): String = roomCodeFromLink(value) ?: value.trim().uppercase()

private fun formatCallDate(value: String): String = runCatching {
    OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd MMM", Locale.forLanguageTag("ru"))).trimEnd('.')
}.getOrDefault("Недавно")

private fun formatDuration(seconds: Int): String = if (seconds < 60) "$seconds сек" else "${seconds / 60} мин"
private fun formatBytes(bytes: Long): String = if (bytes < 1024 * 1024) "${bytes / 1024} КБ" else "%.1f МБ".format(bytes / 1024.0 / 1024.0)
