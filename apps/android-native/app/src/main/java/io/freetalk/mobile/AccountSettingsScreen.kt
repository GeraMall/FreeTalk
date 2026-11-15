package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
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
    onBack: () -> Unit, onUser: (SignedInUser) -> Unit, onLogout: () -> Unit, appearance: NativeAppearance? = null) {
    var section by remember { mutableStateOf("") }
    var name by remember(user) { mutableStateOf(user.displayName) }
    var bio by remember(user) { mutableStateOf(user.bio) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var reset by remember { mutableStateOf(false) }
    var cacheBytes by remember { mutableLongStateOf(0) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val saveCallReport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            runCatching {
                val report = CallDiagnostics.export()
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    checkNotNull(context.contentResolver.openOutputStream(uri)).bufferedWriter().use { it.write(report) }
                }
            }.onSuccess { error = "Отчёт сохранён" }.onFailure { error = "Не удалось сохранить отчёт" }
        }
    }
    LaunchedEffect(section) { if (section == "Чаты") cacheBytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.sizeBytes() } }
    val back = { if (section.isNotEmpty()) section = "" else onBack() }
    BackHandler(onBack = back)
    Column(Modifier.fillMaxSize().background(MobileDesign.background).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            if (section.isNotEmpty()) WebIconButton(onClick = back) { WebIcon(WebIcons.ArrowBack, "Назад") }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                MobileText(section.ifBlank { "Настройки" }, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                if (section.isEmpty()) MobileText("Выберите раздел", fontSize = 11.sp, color = MobileDesign.muted)
            }
            WebIconButton(onClick = onBack) { WebIcon(WebIcons.Close, "Закрыть настройки") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp).widthIn(max = 650.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (section) {
                "" -> {
                    val sections = listOf(
                        Triple("Профиль", "Имя, аватар и информация о себе", WebIcons.Person),
                        Triple("Интерфейс", "Тема, язык и синхронизация", WebIcons.Palette),
                        Triple("Видео и звук", "Предпросмотр камеры", WebIcons.Videocam),
                        Triple("Устройства", "Подключённые сессии", WebIcons.Devices),
                        Triple("Чаты", "Оформление сообщений и хранилище", WebIcons.ChatBubbleOutline),
                    )
                    sections.chunked(2).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { (title, subtitle, icon) ->
                                Box(Modifier.weight(1f)) { SettingsItem(title, subtitle, icon) { section = title } }
                            }
                            if (row.size < 2) Spacer(Modifier.weight(1f))
                        }
                    }
                    SettingsItem("О приложении", "Версия и информация", WebIcons.Info) { section = "О приложении" }
                    ComputerLoginItem(api)
                }
                "Профиль" -> {
                    ProfileIdentity(user)
                    WebTextField(name, { name = it.take(64) }, label = { MobileText("Имя") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                    WebTextField(bio, { bio = it.take(500) }, label = { MobileText("О себе") }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                    WebButton(onClick = { busy = true; scope.launch {
                        try { onUser(api.updateProfile(name, bio)); error = "Сохранено" } catch (e: Exception) { error = e.message ?: "Не удалось сохранить" } finally { busy = false }
                    } }, enabled = !busy && name.isNotBlank()) { MobileText(if (busy) "Сохраняем…" else "Сохранить") }
                }
                "Интерфейс" -> {
                    MobileText("Язык программы", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    listOf("ru" to "Русский", "en" to "English", "zh-CN" to "简体中文", "kk" to "Қазақша", "be" to "Беларуская", "ka" to "ქართული", "es" to "Español").forEach { (code, title) ->
                        Row(Modifier.fillMaxWidth().clickable { MobilePreferences.language = code; MobilePreferences.save(context) }, verticalAlignment = Alignment.CenterVertically) {
                            WebRadioButton(MobilePreferences.language == code, { MobilePreferences.language = code; MobilePreferences.save(context) })
                            MobileText(title, fontSize = 16.sp)
                        }
                    }
                    HorizontalDivider(color = MobileDesign.stroke)
                    MobileText("Тема оформления", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    listOf("default" to "Космическая", "light" to "Светлая", "black" to "Чёрная").forEach { (theme, title) ->
                        WebOutlinedButton(enabled = appearance?.busy != true, onClick = {
                            if (appearance == null) { MobilePreferences.theme = theme; MobilePreferences.save(context) }
                            else scope.launch { appearance.choose(api, theme) }
                        }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (MobilePreferences.theme == theme) MobileDesign.outgoing else Color.Transparent)) {
                            WebIcon(if (MobilePreferences.theme == theme) WebIcons.CheckCircle else WebIcons.Circle, null)
                            MobileText(title, fontSize = 16.sp, modifier = Modifier.padding(10.dp))
                        }
                    }
                    Surface(color = MobileDesign.incoming, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                MobileText("Синхронизировать тему", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                                MobileText("Тема хранится на этом устройстве. Включите синхронизацию, чтобы применять её на других устройствах.", fontSize = 13.sp, color = MobileDesign.muted)
                            }
                            WebSwitch(appearance?.syncEnabled == true, { scope.launch { appearance?.toggle(api, it) } }, enabled = appearance?.available == true && !appearance.busy)
                        }
                    }
                    if (appearance?.error == true) {
                        MobileText("Не удалось синхронизировать тему. Локальный выбор сохранён.", color = MobileDesign.red)
                        WebTextButton(onClick = { scope.launch { appearance.refresh(api); appearance.choose(api, MobilePreferences.theme) } }) { MobileText("Повторить") }
                    }
                }
                "Видео и звук" -> {
                    MobileText("Демонстрация экрана", fontWeight = FontWeight.SemiBold)
                    ScreenShareOptions()
                    HorizontalDivider(color = MobileDesign.stroke)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        MobileText("Зеркалить свою камеру", Modifier.weight(1f), fontSize = 16.sp)
                        WebSwitch(MobilePreferences.mirrorSelf, { MobilePreferences.mirrorSelf = it; MobilePreferences.save(context) })
                    }
                    MobileText("Настройка меняет только ваш предпросмотр. Собеседники видят обычное изображение.", fontSize = 13.sp, color = MobileDesign.muted)
                    MobileText("Устройства вывода звука и переключение камеры доступны в меню «Ещё» во время звонка.", fontSize = 13.sp, color = MobileDesign.muted)
                }
                "Устройства" -> devices.forEach { device ->
                    Surface(color = MobileDesign.incoming, shape = RoundedCornerShape(14.dp)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            MobileText(if (device.current) "Это устройство" else device.userAgent, fontWeight = FontWeight.SemiBold)
                            MobileText("Последняя активность: ${device.lastActiveAt.take(16).replace('T', ' ')}", fontSize = 12.sp, color = MobileDesign.muted)
                        }
                    }
                }
                "Чаты" -> {
                    MobileText("Размер текста", fontWeight = FontWeight.SemiBold)
                    Slider(MobilePreferences.textScale, { MobilePreferences.textScale = it; MobilePreferences.save(context) }, valueRange = .9f..1.3f, steps = 3)
                    MobileMessage("Привет! Как дела?", "12:00", false)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { MobileMessage("Всё отлично, созвонимся?", "12:01", true) }
                    HorizontalDivider(color = MobileDesign.stroke)
                    MobileText("Кэш изображений: ${cacheBytes / 1024 / 1024} МБ", fontWeight = FontWeight.SemiBold)
                    MobileText("Лимит 384 МБ. Старые файлы удаляются автоматически.", fontSize = 12.sp, color = MobileDesign.muted)
                    WebOutlinedButton(onClick = { scope.launch { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.clear() }; cacheBytes = 0 } }) { MobileText("Очистить кэш") }
                }
                "О приложении" -> {
                    MobileAvatar("TRLKA", null, 64.dp, bot = true)
                    MobileText("TRLKA", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    MobileText("${BuildConfig.VERSION_NAME} · нативная beta", color = MobileDesign.muted)
                    MobileText("Голосовые и видеозвонки, демонстрация экрана, сообщения и друзья.", fontSize = 14.sp)
                    WebOutlinedButton(onClick = { saveCallReport.launch("Trlka-Android-call-${System.currentTimeMillis()}.json") }) {
                        WebIcon(WebIcons.SaveAlt, null); Spacer(Modifier.width(8.dp)); MobileText("Сохранить диагностику звонка")
                    }
                    MobileText("Последняя попытка подключения. Без сообщений, адресов и паролей. Отправляется только вручную.", fontSize = 12.sp, color = MobileDesign.muted)
                }
            }
            if (error.isNotEmpty()) MobileText(error, color = MobileDesign.accent, fontSize = 13.sp)
        if (section.isEmpty()) Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            WebOutlinedButton(onClick = { reset = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp)) {
                WebIcon(WebIcons.Restore, null); Spacer(Modifier.width(8.dp)); MobileText("Сбросить настройки", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            WebOutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                WebIcon(WebIcons.Logout, null, tint = MobileDesign.red); Spacer(Modifier.width(8.dp)); MobileText("Выйти из аккаунта", color = MobileDesign.red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        }

    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { MobileText("Выйти из аккаунта?") },
        confirmButton = { WebTextButton(onClick = onLogout) { MobileText("Выйти", color = MobileDesign.red) } }, dismissButton = { WebTextButton(onClick = { confirm = false }) { MobileText("Отмена") } })
    if (reset) AlertDialog(onDismissRequest = { reset = false }, title = { MobileText("Сбросить настройки?") },
        text = { MobileText("Размер сообщений, зеркальный предпросмотр камеры и качество демонстрации вернутся к значениям по умолчанию.") },
        confirmButton = { WebTextButton(onClick = { MobilePreferences.textScale = 1f; MobilePreferences.mirrorSelf = true; MobilePreferences.shareQuality = ScreenShareQuality(); MobilePreferences.save(context); reset = false }) { MobileText("Сбросить") } },
        dismissButton = { WebTextButton(onClick = { reset = false }) { MobileText("Отмена") } })
}

@Composable
internal fun SettingsItem(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), color = MobileDesign.incoming,
        shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
        Row(Modifier.heightIn(min = 66.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            WebIcon(icon, null, Modifier.size(20.dp), tint = MobileDesign.accent)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MobileText(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            WebIcon(WebIcons.ChevronRight, null, Modifier.size(18.dp), tint = MobileDesign.muted)
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
            MobileText(user.displayName, localize = false, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            MobileText("@${user.username}", color = MobileDesign.muted, fontSize = 12.sp)
            if (user.bio.isNotBlank()) MobileText(user.bio, localize = false, fontSize = 14.sp)
        }
    }
}
