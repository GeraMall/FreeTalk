package io.freetalk.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import java.security.SecureRandom

class MainActivity : ComponentActivity() {
    private lateinit var api: FreeTalkApi
    private lateinit var cache: MediaCache

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        api = FreeTalkApi(SessionStore(this))
        cache = MediaCache(this).also { it.trim() }
        setContent { FreeTalkNativeApp(api, cache) }
    }
}

private val colors = darkColorScheme(
    primary = Color(0xFF43E1E8),
    background = Color(0xFF030A15),
    surface = Color(0xFF071523),
    onPrimary = Color(0xFF02101A),
    onBackground = Color(0xFFF4F8FF),
    onSurface = Color(0xFFF4F8FF),
)

@Composable
private fun FreeTalkNativeApp(api: FreeTalkApi, cache: MediaCache) {
    var user by remember { mutableStateOf<SignedInUser?>(null) }
    var status by remember { mutableStateOf("") }
    var roomId by remember { mutableStateOf<String?>(null) }
    val activity = androidx.compose.ui.platform.LocalContext.current as MainActivity
    val signaling = remember {
        RoomSignaling { event ->
            activity.runOnUiThread {
                when (event) {
                    RoomEvent.Connected -> status = "Сигналинг подключён"
                    is RoomEvent.Created -> { roomId = event.roomId; status = "Комната создана" }
                    is RoomEvent.Error -> status = event.message
                    RoomEvent.Disconnected -> status = "Соединение закрыто"
                }
            }
        }
    }
    MaterialTheme(colorScheme = colors) {
        Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
            if (user == null) {
                LoginScreen(status) { login, password ->
                    status = "Входим…"
                    activity.lifecycleScope.launch {
                        runCatching { api.login(login, password) }
                            .onSuccess { session -> user = session.user; status = "" }
                            .onFailure { status = it.message ?: "Не удалось войти" }
                    }
                }
            } else {
                NativeShell(user!!, roomId, status, cache) {
                    val code = generateRoomCode()
                    status = "Создаём комнату…"
                    signaling.create(code, user!!, api.accessToken!!)
                }
            }
        }
    }
}

@Composable
private fun LoginScreen(status: String, onLogin: (String, String) -> Unit) {
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().background(colors.background).padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("FreeTalk", fontSize = 42.sp, fontWeight = FontWeight.Bold)
        Text("Нативная Android Beta", color = colors.primary)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(login, { login = it }, label = { Text("Почта или @username") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, label = { Text("Пароль") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(18.dp))
        Button(onClick = { onLogin(login, password) }, enabled = login.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text("Войти")
        }
        if (status.isNotBlank()) Text(status, modifier = Modifier.padding(top = 16.dp), color = Color(0xFFFF8096))
    }
}

@Composable
private fun NativeShell(user: SignedInUser, roomId: String?, status: String, cache: MediaCache, onCreateRoom: () -> Unit) {
    var page by remember { mutableStateOf(0) }
    var cacheBytes by remember { mutableLongStateOf(cache.sizeBytes()) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf("Главная", "Чаты", "Друзья", "История").forEachIndexed { index, title ->
                    NavigationBarItem(selected = page == index, onClick = { page = index }, icon = { Text(listOf("⌂", "●", "♙", "◷")[index]) }, label = { Text(title) })
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("FreeTalk", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("${user.displayName.take(1).uppercase()}", color = colors.primary, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(28.dp))
            when (page) {
                0 -> {
                    Text("Добрый вечер, ${user.displayName}", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("Стабильная связь и работа без VPN", color = Color(0xFF91A4B8))
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = onCreateRoom, modifier = Modifier.fillMaxWidth().height(56.dp), colors = ButtonDefaults.buttonColors(containerColor = colors.primary)) {
                        Text("Создать комнату")
                    }
                    if (roomId != null) Text("Комната: $roomId", modifier = Modifier.padding(top = 18.dp), color = Color(0xFF5AF0BC))
                    if (status.isNotBlank()) Text(status, modifier = Modifier.padding(top = 12.dp))
                }
                1 -> Placeholder("Чаты", "Список и сообщения будут подключены к существующему API.")
                2 -> Placeholder("Друзья", "Друзья и приглашения будут здесь.")
                else -> {
                    Placeholder("История", "История звонков и управление локальными данными.")
                    Spacer(Modifier.height(28.dp))
                    Text("Кэш изображений: ${formatBytes(cacheBytes)}")
                    OutlinedButton(onClick = { cache.clear(); cacheBytes = 0 }, modifier = Modifier.padding(top = 12.dp)) { Text("Очистить кэш") }
                }
            }
        }
    }
}

@Composable
private fun Placeholder(title: String, subtitle: String) {
    Box(Modifier.fillMaxWidth().background(colors.surface, RoundedCornerShape(20.dp)).padding(20.dp)) {
        Column { Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold); Text(subtitle, color = Color(0xFF91A4B8)) }
    }
}

private fun generateRoomCode(): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val random = SecureRandom()
    return buildString { repeat(12) { append(alphabet[random.nextInt(alphabet.length)]) } }
}

private fun formatBytes(bytes: Long): String = if (bytes < 1024 * 1024) "${bytes / 1024} КБ" else "%.1f МБ".format(bytes / 1024.0 / 1024.0)
