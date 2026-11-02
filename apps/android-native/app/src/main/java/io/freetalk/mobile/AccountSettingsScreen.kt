package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
internal fun AccountSettingsScreen(api: FreeTalkApi, cache: MediaCache, user: SignedInUser, devices: List<AccountDevice>,
    onBack: () -> Unit, onUser: (SignedInUser) -> Unit, onLogout: () -> Unit) {
    var section by remember { mutableStateOf("") }
    var name by remember(user) { mutableStateOf(user.displayName) }
    var bio by remember(user) { mutableStateOf(user.bio) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var cacheBytes by remember { mutableLongStateOf(0) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(section) { if (section == "Чаты") cacheBytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.sizeBytes() } }
    val back = { if (section.isNotEmpty()) section = "" else onBack() }
    BackHandler(onBack = back)
    Column(Modifier.fillMaxSize().background(MobileDesign.background).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Icon(if (section.isEmpty()) Icons.Outlined.Close else Icons.AutoMirrored.Outlined.ArrowBack, "Назад") }
            Text(section.ifBlank { "Настройки" }, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp).widthIn(max = 650.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (section) {
                "" -> {
                    SettingsItem("Профиль", "Имя, аватар и информация о себе", Icons.Outlined.Person) { section = "Профиль" }
                    SettingsItem("Видео и звук", "Предпросмотр камеры", Icons.Outlined.Videocam) { section = "Видео и звук" }
                    SettingsItem("Устройства", "Подключённые сессии", Icons.Outlined.Devices) { section = "Устройства" }
                    SettingsItem("Чаты", "Оформление сообщений и хранилище", Icons.Outlined.ChatBubbleOutline) { section = "Чаты" }
                    SettingsItem("О приложении", "Версия и информация", Icons.Outlined.Info) { section = "О приложении" }
                }
                "Профиль" -> {
                    ProfileIdentity(user)
                    OutlinedTextField(name, { name = it.take(64) }, label = { Text("Имя") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                    OutlinedTextField(bio, { bio = it.take(500) }, label = { Text("О себе") }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                    Button(onClick = { busy = true; scope.launch {
                        try { onUser(api.updateProfile(name, bio)); error = "Сохранено" } catch (e: Exception) { error = e.message ?: "Не удалось сохранить" } finally { busy = false }
                    } }, enabled = !busy && name.isNotBlank()) { Text(if (busy) "Сохраняем…" else "Сохранить") }
                }
                "Видео и звук" -> {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Зеркалить свою камеру", Modifier.weight(1f), fontSize = 16.sp)
                        Switch(MobilePreferences.mirrorSelf, { MobilePreferences.mirrorSelf = it; MobilePreferences.save(context) })
                    }
                    Text("Настройка меняет только ваш предпросмотр. Собеседники видят обычное изображение.", fontSize = 13.sp, color = MobileDesign.muted)
                    Text("Устройства вывода звука и переключение камеры доступны в меню «Ещё» во время звонка.", fontSize = 13.sp, color = MobileDesign.muted)
                }
                "Устройства" -> devices.forEach { device ->
                    SettingsItem(if (device.current) "Это устройство" else device.userAgent, "Последняя активность: ${device.lastActiveAt.take(16).replace('T', ' ')}", Icons.Outlined.Devices) {}
                }
                "Чаты" -> {
                    Text("Размер текста", fontWeight = FontWeight.SemiBold)
                    Slider(MobilePreferences.textScale, { MobilePreferences.textScale = it; MobilePreferences.save(context) }, valueRange = .9f..1.3f, steps = 3)
                    MobileMessage("Привет! Как дела?", "12:00", false)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { MobileMessage("Всё отлично, созвонимся?", "12:01", true) }
                    HorizontalDivider(color = MobileDesign.stroke)
                    Text("Кэш изображений: ${cacheBytes / 1024 / 1024} МБ", fontWeight = FontWeight.SemiBold)
                    Text("Лимит 384 МБ. Старые файлы удаляются автоматически.", fontSize = 12.sp, color = MobileDesign.muted)
                    OutlinedButton(onClick = { scope.launch { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.clear() }; cacheBytes = 0 } }) { Text("Очистить кэш") }
                }
                "О приложении" -> {
                    MobileAvatar("TRLKA", null, 64.dp, bot = true)
                    Text("TRLKA", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("${BuildConfig.VERSION_NAME} · нативная beta", color = MobileDesign.muted)
                    Text("Голосовые и видеозвонки, демонстрация экрана, сообщения и друзья.", fontSize = 14.sp)
                }
            }
            if (error.isNotEmpty()) Text(error, color = MobileDesign.accent, fontSize = 13.sp)
        }
        if (section.isEmpty()) OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(12.dp)) {
            Icon(Icons.Outlined.Logout, null, tint = MobileDesign.red); Spacer(Modifier.width(8.dp)); Text("Выйти из аккаунта", color = MobileDesign.red)
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Выйти из аккаунта?") },
        confirmButton = { TextButton(onClick = onLogout) { Text("Выйти", color = MobileDesign.red) } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Отмена") } })
}

@Composable
internal fun SettingsItem(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), color = MobileDesign.incoming,
        shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(icon, null, Modifier.size(24.dp), tint = MobileDesign.accent)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(subtitle, fontSize = 11.sp, color = MobileDesign.muted)
            }
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp), tint = MobileDesign.muted)
        }
    }
}

@Composable
internal fun ProfileIdentity(user: SignedInUser) {
    Column(Modifier.fillMaxWidth().background(MobileDesign.incoming, RoundedCornerShape(18.dp)), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth().height(110.dp).background(MobileDesign.gradient, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))) {
            if (user.coverUrl != null) AsyncImage(user.coverUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MobileAvatar(user.displayName, user.avatarUrl, 64.dp)
            Text(user.displayName, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("@${user.username}", color = MobileDesign.muted, fontSize = 12.sp)
            if (user.bio.isNotBlank()) Text(user.bio, fontSize = 14.sp)
        }
    }
}
