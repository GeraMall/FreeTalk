package io.freetalk.mobile

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
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
import coil.compose.AsyncImage
import java.security.SecureRandom
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api = FreeTalkApi(SessionStore(this))
        val cache = MediaCache(this).also { it.trim() }
        setContent { FreeTalkNativeApp(api, cache) }
    }
}

private val colors = darkColorScheme(
    primary = Color(0xFF4EF3F2), background = Color(0xFF010811),
    surface = Color(0xFF03101E), surfaceVariant = Color(0xFF071827),
    onPrimary = Color(0xFF02101A), onBackground = Color(0xFFF4F8FF), onSurface = Color(0xFFF4F8FF),
)
private val muted = Color(0xFF91A4B8)
private val good = Color(0xFF55EFB7)
private val danger = Color(0xFFFF8096)
private val cyanBlueGradient = Brush.linearGradient(
    listOf(Color(0xFF4EF3F2), Color(0xFF59BEF9), Color(0xFF3D7BFF)),
)
private val appBackground = Brush.radialGradient(
    listOf(Color(0xFF0A3540), Color(0xFF07182B), Color(0xFF010811)), radius = 1350f,
)

private enum class AuthPage { Login, Register, Verify }

@Composable
private fun FreeTalkNativeApp(api: FreeTalkApi, cache: MediaCache) {
    var user by remember { mutableStateOf<SignedInUser?>(null) }
    var restoring by remember { mutableStateOf(true) }
    var status by remember { mutableStateOf("") }
    var authPage by remember { mutableStateOf(AuthPage.Login) }
    var verificationEmail by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        user = api.restore()
        restoring = false
    }

    MaterialTheme(colorScheme = colors) {
        Surface(Modifier.fillMaxSize(), color = colors.background) {
            when {
                restoring -> LoadingScreen("Восстанавливаем вход…")
                user == null -> AuthScreen(
                    page = authPage,
                    status = status,
                    verificationEmail = verificationEmail,
                    onPage = { authPage = it; status = "" },
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
                    onRegister = { email, username, name, password ->
                        status = "Создаём аккаунт…"
                        scope.launch {
                            runCatching { api.register(email, username, name, password) }
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
            Text(label, color = muted, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun AuthScreen(
    page: AuthPage,
    status: String,
    verificationEmail: String,
    onPage: (AuthPage) -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String, String) -> Unit,
    onVerify: (String, String) -> Unit,
    onResend: (String) -> Unit,
) {
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var email by remember(verificationEmail) { mutableStateOf(verificationEmail) }
    var username by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    LazyColumn(
        Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        item {
            Text("◉ FreeTalk", fontSize = 38.sp, fontWeight = FontWeight.Black)
            Text("Нативная Android Beta", color = colors.primary, modifier = Modifier.padding(top = 4.dp, bottom = 26.dp))
            when (page) {
                AuthPage.Login -> {
                    AuthField(login, { login = it }, "Почта или @username")
                    AuthField(password, { password = it }, "Пароль", password = true)
                    PrimaryAction("Войти", login.isNotBlank() && password.isNotBlank()) { onLogin(login, password) }
                    TextButton(onClick = { onPage(AuthPage.Register) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Создать аккаунт")
                    }
                }
                AuthPage.Register -> {
                    Text("Новый аккаунт", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
                    AuthField(email, { email = it }, "Почта", KeyboardType.Email)
                    AuthField(username, { username = it }, "Имя пользователя")
                    AuthField(name, { name = it }, "Отображаемое имя")
                    AuthField(password, { password = it }, "Пароль", password = true)
                    PrimaryAction("Продолжить", email.isNotBlank() && username.length >= 3 && name.isNotBlank() && password.length >= 8) {
                        onRegister(email, username, name, password)
                    }
                    TextButton(onClick = { onPage(AuthPage.Login) }, modifier = Modifier.fillMaxWidth()) { Text("Уже есть аккаунт") }
                }
                AuthPage.Verify -> {
                    Text("Подтвердите почту", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text("Введите шестизначный код из письма", color = muted, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
                    AuthField(email, { email = it }, "Почта", KeyboardType.Email)
                    AuthField(code, { code = it.filter(Char::isDigit).take(6) }, "Код", KeyboardType.Number)
                    PrimaryAction("Подтвердить", email.isNotBlank() && code.length == 6) { onVerify(email, code) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { onPage(AuthPage.Login) }) { Text("Назад") }
                        TextButton(onClick = { onResend(email) }, enabled = email.isNotBlank()) { Text("Отправить ещё раз") }
                    }
                }
            }
            if (status.isNotBlank()) Text(status, modifier = Modifier.padding(top = 12.dp), color = if (status.contains("отправ", true)) good else danger)
        }
    }
}

@Composable
private fun AuthField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
) {
    OutlinedTextField(
        value, onValue, label = { Text(label) }, modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        singleLine = true,
    )
}

@Composable
private fun PrimaryAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().height(54.dp),
        colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
    ) { Text(label, fontWeight = FontWeight.Bold) }
}

@Composable
private fun NativeShell(api: FreeTalkApi, cache: MediaCache, user: SignedInUser, onLogout: () -> Unit) {
    var page by remember { mutableStateOf(0) }
    var data by remember { mutableStateOf<AccountData?>(null) }
    var error by remember { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(true) }
    var roomStatus by remember { mutableStateOf("") }
    var roomId by remember { mutableStateOf<String?>(null) }
    var activeChat by remember { mutableStateOf<ChatSummary?>(null) }
    val scope = rememberCoroutineScope()
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val load: () -> Unit = {
        refreshing = true
        scope.launch {
            runCatching { api.loadAccountData() }
                .onSuccess { data = it; error = "" }
                .onFailure { error = it.message ?: "Не удалось загрузить данные" }
            refreshing = false
        }
        Unit
    }
    val signaling = remember {
        RoomSignaling { event ->
            mainHandler.post {
                when (event) {
                    RoomEvent.Connected -> roomStatus = "Сигналинг подключён"
                    is RoomEvent.Created -> { roomId = event.roomId; roomStatus = "Комната создана" }
                    is RoomEvent.Error -> roomStatus = event.message
                    RoomEvent.Disconnected -> roomStatus = "Соединение закрыто"
                }
            }
        }
    }
    LaunchedEffect(user.id) { load() }

    if (roomId != null) {
        RoomScreen(
            user = user,
            roomId = roomId!!,
            status = roomStatus,
            onLeave = {
                signaling.close()
                roomId = null
                roomStatus = ""
                load()
            },
        )
        return
    }

    if (activeChat != null) {
        ChatScreen(api, user, activeChat!!, onBack = { activeChat = null }, onChanged = load)
        return
    }

    Scaffold(
        modifier = Modifier.background(appBackground),
        containerColor = Color.Transparent,
        bottomBar = {
            NavigationBar(containerColor = Color(0xF7061321), tonalElevation = 0.dp) {
                listOf("Главная", "Чаты", "Друзья", "История").forEachIndexed { index, title ->
                    NavigationBarItem(
                        selected = page == index, onClick = { page = index },
                        icon = {
                            Icon(
                                listOf(Icons.Outlined.Home, Icons.Outlined.ChatBubbleOutline, Icons.Outlined.PeopleOutline, Icons.Outlined.History)[index],
                                contentDescription = title,
                            )
                        },
                        label = { Text(title, maxLines = 1, fontWeight = if (page == index) FontWeight.Bold else FontWeight.Medium) },
                        colors = androidx.compose.material3.NavigationBarItemDefaults.colors(
                            selectedIconColor = colors.primary,
                            selectedTextColor = colors.primary,
                            indicatorColor = Color(0xFF09242F),
                            unselectedIconColor = Color(0xFF6E849B),
                            unselectedTextColor = Color(0xFF6E849B),
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            AppHeader(user, data?.devices?.size ?: 0, onLogout)
            if (error.isNotBlank()) ErrorCard(error, load)
            when {
                refreshing && data == null -> LoadingScreen("Загружаем FreeTalk…")
                page == 0 -> HomePage(
                    user = user, data = data, roomId = roomId, status = roomStatus,
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
                page == 1 -> ChatsPage(user, data?.chats.orEmpty(), activeChat = { activeChat = it }, onRefresh = load)
                page == 2 -> FriendsPage(data?.friends.orEmpty(), data?.pendingFriends ?: 0, load)
                else -> HistoryPage(data?.calls.orEmpty(), data?.devices.orEmpty(), cache)
            }
        }
    }
}

@Composable
private fun RoomScreen(user: SignedInUser, roomId: String, status: String, onLeave: () -> Unit) {
    var isMuted by remember { mutableStateOf(false) }
    var cameraEnabled by remember { mutableStateOf(false) }
    Scaffold(
        modifier = Modifier.background(appBackground), containerColor = Color.Transparent,
        topBar = {
            Column(Modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = 18.dp, vertical = 10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.freetalk_mascot), null, modifier = Modifier.size(38.dp))
                        Text("FreeTalk", fontSize = 20.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(start = 7.dp))
                    }
                    Text("Голосовая комната", color = muted, fontSize = 13.sp)
                }
                HorizontalDivider(color = Color(0xFF102537), modifier = Modifier.padding(top = 10.dp))
            }
        },
        bottomBar = {
            Row(
                Modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = 18.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                RoomControl(if (isMuted) Icons.Outlined.MicOff else Icons.Outlined.Mic, isMuted) { isMuted = !isMuted }
                RoomControl(if (cameraEnabled) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, !cameraEnabled) { cameraEnabled = !cameraEnabled }
                RoomControl(Icons.Outlined.MoreHoriz, false) {}
                Box(
                    Modifier.padding(start = 14.dp).size(58.dp).clip(RoundedCornerShape(18.dp))
                        .background(Color(0xFFE83F5F)).clickable(onClick = onLeave),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.CallEnd, "Завершить звонок", tint = Color.White) }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 18.dp)) {
            Text("Участники", fontSize = 28.sp, fontWeight = FontWeight.Black)
            Text("Комната · $roomId", color = muted, fontSize = 13.sp, modifier = Modifier.padding(top = 3.dp))
            Surface(
                Modifier.fillMaxWidth().padding(top = 28.dp), color = Color(0xD9051424),
                shape = RoundedCornerShape(22.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x443D8AA7)),
            ) {
                Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.size(92.dp).clip(CircleShape).background(Color(0xFF10354A))
                            .border(2.dp, colors.primary, CircleShape), contentAlignment = Alignment.Center,
                    ) {
                        if (user.avatarUrl != null) AsyncImage(
                            model = user.avatarUrl, contentDescription = user.displayName,
                            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                        ) else Text(user.displayName.take(1).uppercase(), fontSize = 32.sp, fontWeight = FontWeight.Black)
                    }
                    Text(user.displayName, fontSize = 21.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 13.dp))
                    Text("Создатель комнаты", color = colors.primary, fontSize = 12.sp)
                    Text(if (isMuted) "Микрофон выключен" else "В звонке", color = if (isMuted) danger else good, fontSize = 13.sp, modifier = Modifier.padding(top = 9.dp))
                }
            }
            Text(status, color = muted, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp))
        }
    }
}

@Composable
private fun RoomControl(icon: androidx.compose.ui.graphics.vector.ImageVector, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.padding(horizontal = 4.dp).size(52.dp).clip(RoundedCornerShape(17.dp))
            .background(if (active) Color(0xFF351522) else Color(0xFF092231)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = if (active) danger else colors.primary) }
}

@Composable
private fun AppHeader(user: SignedInUser, deviceCount: Int, onLogout: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.freetalk_mascot),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.size(49.dp),
                )
                Text("FreeTalk", fontSize = 24.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(start = 9.dp))
            }
            Box(
                Modifier.size(48.dp).clip(CircleShape).background(Color(0xFF10354A))
                    .border(1.dp, Color(0x664EF3F2), CircleShape).clickable { open = !open },
                contentAlignment = Alignment.Center,
            ) {
                if (user.avatarUrl != null) {
                    AsyncImage(
                        model = user.avatarUrl, contentDescription = user.displayName,
                        contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                    )
                } else Text(user.displayName.take(1).uppercase(), color = colors.primary, fontWeight = FontWeight.Bold)
            }
        }
        if (open) {
            Surface(Modifier.fillMaxWidth().padding(top = 12.dp), color = colors.surface, shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text(user.displayName, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("@${user.username}", color = muted)
                    Text("Подключено устройств: $deviceCount", color = colors.primary, modifier = Modifier.padding(top = 10.dp))
                    OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("Выйти из аккаунта", color = danger) }
                }
            }
        }
        HorizontalDivider(color = Color(0xFF102537), modifier = Modifier.padding(top = if (open) 12.dp else 6.dp))
    }
}

@Composable
private fun ErrorCard(message: String, retry: () -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(bottom = 12.dp), color = Color(0xFF35141E), shape = RoundedCornerShape(14.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, color = danger, modifier = Modifier.weight(1f))
            TextButton(onClick = retry) { Text("Повторить") }
        }
    }
}

@Composable
private fun HomePage(
    user: SignedInUser,
    data: AccountData?,
    roomId: String?,
    status: String,
    onCreateRoom: () -> Unit,
    onJoinRoom: (String) -> Unit,
) {
    var roomCode by remember { mutableStateOf("") }
    val recentCalls = data?.calls.orEmpty().take(4)
    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp)) {
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
                    Text(
                        "СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!", color = colors.primary,
                        fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.8.sp,
                    )
                    Text(
                        "Добрый вечер,\n${user.displayName}", fontSize = 35.sp, lineHeight = 37.sp,
                        fontWeight = FontWeight.Black, modifier = Modifier.padding(top = 24.dp),
                    )
                    Text(
                        "Создайте приватную комнату или войдите по приглашению.",
                        color = Color(0xFFAEBCCE), fontSize = 16.sp, lineHeight = 23.sp,
                        modifier = Modifier.fillMaxWidth(0.87f).padding(top = 18.dp, bottom = 24.dp),
                    )
                    Box(
                        Modifier.fillMaxWidth().height(58.dp).clip(RoundedCornerShape(13.dp))
                            .background(cyanBlueGradient).clickable(onClick = onCreateRoom),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.MeetingRoom, null, tint = Color(0xFF031018), modifier = Modifier.size(27.dp))
                            Text("Создать комнату", color = Color(0xFF031018), fontWeight = FontWeight.Black, fontSize = 19.sp, modifier = Modifier.padding(start = 10.dp))
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            roomCode, { roomCode = it }, placeholder = { Text("Код или ссылка комнаты", color = Color(0xFF61758D)) },
                            singleLine = true, modifier = Modifier.weight(1f).height(58.dp),
                        )
                        Box(
                            Modifier.padding(start = 8.dp).size(58.dp).clip(RoundedCornerShape(13.dp))
                                .background(Color(0xB9051220)).border(1.dp, Color(0x553D9CAB), RoundedCornerShape(13.dp))
                                .clickable(enabled = roomCode.isNotBlank()) { onJoinRoom(roomCode) },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Войти", tint = if (roomCode.isBlank()) muted else colors.primary) }
                    }
                    if (roomId != null) Text("Комната: $roomId", color = good, modifier = Modifier.padding(top = 12.dp))
                    if (status.isNotBlank()) Text(status, color = muted, fontSize = 13.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Column {
                    Text("ВАШИ ЗВОНКИ", color = colors.primary, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.7.sp)
                    Text("Недавние комнаты", fontSize = 28.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(top = 5.dp))
                }
                Text("Последние ${recentCalls.size}", color = muted, fontSize = 13.sp)
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
                Row(Modifier.width(if (visible.size > 1) 68.dp else 46.dp)) {
                    visible.forEachIndexed { index, participant ->
                        Box(
                            Modifier.offset(x = (-index * 10).dp).size(46.dp).clip(CircleShape)
                                .background(cyanBlueGradient).border(2.dp, Color(0xFF061322), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (participant.avatarUrl != null) {
                                AsyncImage(
                                    model = participant.avatarUrl, contentDescription = participant.displayName,
                                    contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                                )
                            } else Text(participant.displayName.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Column(Modifier.weight(1f).padding(start = 13.dp)) {
                    Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${formatCallDate(call.startedAt)} · ${formatDuration(call.durationSeconds)}", color = muted, fontSize = 13.sp)
                }
            }
            OutlinedButton(
                onClick = onCreateAgain, modifier = Modifier.fillMaxWidth().padding(top = 14.dp).height(46.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x664EF3F2)),
            ) {
                Icon(Icons.Outlined.Call, null, modifier = Modifier.size(19.dp))
                Text("Создать снова", modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

@Composable
private fun ChatsPage(user: SignedInUser, chats: List<ChatSummary>, activeChat: (ChatSummary) -> Unit, onRefresh: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val shown = chats.filter { it.displayTitle(user.id).contains(query, true) }
    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Чаты и группы", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = onRefresh) { Text("Обновить") }
        }
        OutlinedTextField(query, { query = it }, placeholder = { Text("Поиск по чатам") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        LazyColumn(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (shown.isEmpty()) item { EmptyState("Чатов пока нет", "Новые личные и групповые чаты появятся здесь") }
            items(shown, key = { it.id }) { chat ->
                ListCard(
                    chat.displayTitle(user.id), chat.lastMessage ?: "Сообщений пока нет",
                    chat.displayTitle(user.id).take(1),
                    imageUrl = chat.avatarUrl ?: chat.members.firstOrNull { it.id != user.id }?.avatarUrl,
                ) { activeChat(chat) }
            }
        }
    }
}

@Composable
private fun FriendsPage(friends: List<FriendSummary>, pending: Int, onRefresh: () -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("Друзья", fontSize = 26.sp, fontWeight = FontWeight.Bold); if (pending > 0) Text("Новых запросов: $pending", color = colors.primary) }
            TextButton(onClick = onRefresh) { Text("Обновить") }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (friends.isEmpty()) item { EmptyState("Список пуст", "Добавленные друзья появятся здесь") }
            items(friends, key = { it.id }) { friend ->
                val online = friend.presence != "offline"
                ListCard(
                    friend.displayName, "@${friend.username} · ${if (online) "В сети" else "Не в сети"}",
                    friend.displayName.take(1), imageUrl = friend.avatarUrl, online = online,
                )
            }
        }
    }
}

@Composable
private fun HistoryPage(calls: List<CallSummary>, devices: List<AccountDevice>, cache: MediaCache) {
    var cacheBytes by remember { mutableLongStateOf(cache.sizeBytes()) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("История", fontSize = 26.sp, fontWeight = FontWeight.Bold) }
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
                    Text("Кэш изображений: ${formatBytes(cacheBytes)}", fontWeight = FontWeight.SemiBold)
                    Text("Лимит 384 МБ. Старые файлы удаляются автоматически.", color = muted, fontSize = 13.sp)
                    OutlinedButton(onClick = { cache.clear(); cacheBytes = 0 }, modifier = Modifier.padding(top = 10.dp)) { Text("Очистить кэш") }
                }
            }
        }
    }
}

@Composable
private fun ChatScreen(api: FreeTalkApi, user: SignedInUser, chat: ChatSummary, onBack: () -> Unit, onChanged: () -> Unit) {
    var messages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var input by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(chat.id) {
        runCatching { api.loadMessages(chat.id) }
            .onSuccess { messages = it }.onFailure { error = it.message ?: "Не удалось открыть чат" }
        loading = false
    }
    Scaffold(
        containerColor = colors.background,
        topBar = {
            Row(Modifier.fillMaxWidth().safeDrawingPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack) { Text("‹ Назад") }
                Text(chat.displayTitle(user.id), fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        bottomBar = {
            Row(Modifier.fillMaxWidth().safeDrawingPadding().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(input, { input = it }, placeholder = { Text("Сообщение") }, modifier = Modifier.weight(1f), maxLines = 4)
                Button(
                    onClick = {
                        val text = input.trim(); if (text.isEmpty()) return@Button
                        input = ""
                        scope.launch {
                            runCatching { api.sendMessage(chat.id, text) }
                                .onSuccess { messages = messages + it; onChanged() }
                                .onFailure { error = it.message ?: "Не отправлено"; input = text }
                        }
                    },
                    modifier = Modifier.padding(start = 8.dp),
                ) { Text("➤") }
            }
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loading) item { LoadingScreen("Загружаем сообщения…") }
            if (error.isNotBlank()) item { Text(error, color = danger) }
            if (!loading && messages.isEmpty()) item { EmptyState("Начните разговор", "Сообщения будут синхронизированы с FreeTalk") }
            items(messages, key = { it.id }) { message ->
                val mine = message.senderId == user.id
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(0.82f),
                        color = if (mine) Color(0xFF0D4658) else colors.surface,
                        shape = RoundedCornerShape(18.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                            if (!mine) Text(message.senderName, color = colors.primary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Text(message.body)
                        }
                    }
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
                Modifier.size(46.dp).clip(CircleShape).background(Color(0xFF123046))
                    .border(1.dp, Color(0x553D9CAB), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (imageUrl != null) {
                    AsyncImage(model = imageUrl, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else Text(initial, color = colors.primary, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = if (online) good else muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun EmptyState(title: String, subtitle: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 30.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(title, fontWeight = FontWeight.Bold); Text(subtitle, color = muted, fontSize = 13.sp) }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title.uppercase(), color = muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
    HorizontalDivider(color = Color(0xFF112638))
}

private fun generateRoomCode(): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val random = SecureRandom()
    return buildString { repeat(12) { append(alphabet[random.nextInt(alphabet.length)]) } }
}

private fun normalizeRoomCode(value: String): String = value.trim()
    .substringBefore('?').substringBefore('#').trimEnd('/').substringAfterLast('/').uppercase()

private fun formatCallDate(value: String): String = runCatching {
    OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd MMM", Locale.forLanguageTag("ru"))).trimEnd('.')
}.getOrDefault("Недавно")

private fun formatDuration(seconds: Int): String = if (seconds < 60) "$seconds сек" else "${seconds / 60} мин"
private fun formatBytes(bytes: Long): String = if (bytes < 1024 * 1024) "${bytes / 1024} КБ" else "%.1f МБ".format(bytes / 1024.0 / 1024.0)
