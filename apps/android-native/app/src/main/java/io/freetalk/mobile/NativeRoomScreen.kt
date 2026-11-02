package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.SurfaceViewRenderer
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeRoomScreen(user: SignedInUser, roomId: String, status: String, signaling: RoomSignaling, api: FreeTalkApi,
    chats: List<ChatSummary>, friends: List<FriendSummary>, onLeave: () -> Unit, expanded: Boolean = true, onMinimize: () -> Unit = {}, onQuality: (String) -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = signaling.room
    var media by remember { mutableStateOf<NativeCallMedia?>(null) }
    var sheet by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf("") }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var pendingInvite by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf<String?>(null) }
    var videoMode by remember { mutableStateOf(false) }
    val hasVideo = media?.videos?.isNotEmpty() == true
    LaunchedEffect(hasVideo) { if (hasVideo) videoMode = true else { delay(550); videoMode = false; focused = null } }
    LaunchedEffect(state.peers.map { it.id }) { if (focused != null && state.peers.none { it.id == focused }) focused = null }
    LaunchedEffect(media?.connections?.toMap()) { onQuality(when { media?.connections?.values?.any { it.contains("Ошибка") || it.contains("Потеря") } == true -> "poor"; media?.connections?.values?.any { it == "Подключён" } == true -> "good"; else -> "connecting" }) }
    BackHandler(enabled = expanded) { if (focused != null) focused = null else { sheet = null; onMinimize() } }
    val cyan = Color(0xFF8DA6DC)
    val secondary = Color(0xFF8D9FB3)
    val link = "https://trlka.com/join/$roomId"
    val latestLeave by rememberUpdatedState(onLeave)
    fun startService(extraTypes: Int = 0, action: () -> Unit) {
        CallService.afterStart = { runCatching(action).onFailure { feedback = it.message ?: "Не удалось подключить медиа" } }
        context.startForegroundService(Intent(context, CallService::class.java).putExtra("types",
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or extraTypes))
    }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) startService { if (media == null) media = NativeCallMedia(context.applicationContext, signaling) }
        else feedback = "Разрешите доступ к микрофону, чтобы подключить звук"
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) startService(ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or (if (media?.sharing == true) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)) { media?.startCamera() }
        else feedback = "Доступ к камере не разрешён"
    }
    val screenPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            startService(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or (if (media?.camera == true) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0)) { media?.startScreen(data) }
        }
    }
    val bluetoothPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { sheet = "audio" }
    DisposableEffect(roomId) {
        val activity = generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
            .filterIsInstance<Activity>().firstOrNull()
        val previousVolumeStream = activity?.volumeControlStream
        activity?.volumeControlStream = android.media.AudioManager.STREAM_VOICE_CALL
        CallService.onEnd = { latestLeave() }
        onDispose {
            if (previousVolumeStream != null) activity.volumeControlStream = previousVolumeStream
            CallService.afterStart = null; CallService.onEnd = null; media?.close(); context.stopService(Intent(context, CallService::class.java))
        }
    }
    LaunchedEffect(roomId) { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
    LaunchedEffect(state.closed) { if (state.closed) onLeave() }
    LaunchedEffect(roomId) { while (true) { now = System.currentTimeMillis(); delay(500) } }
    val elapsed = ((now - state.startedAt.coerceAtLeast(1)) / 1000).coerceAtLeast(0)
    if (!expanded) return
    Scaffold(containerColor = Color(0xFF07111D), topBar = {
        if (focused == null) Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { sheet = null; onMinimize() }, modifier = Modifier.background(MobileDesign.incoming, RoundedCornerShape(14.dp))) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Свернуть звонок") }
            Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Комната с друзьями", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text(if (media?.connections?.values?.any { it == "Подключён" } == true) "Связь установлена" else if (state.peers.size < 2) "Ожидаем участников" else "Проверяем связь…", color = secondary, fontSize = 11.sp)
            }
            Text(if (state.startedAt > 0) "%02d:%02d".format(elapsed / 60, elapsed % 60) else "…", color = secondary, fontSize = 11.sp)
        }
    }, bottomBar = {
        CallToolbar(
            muted = media?.muted != false, camera = media?.camera == true, sharing = media?.sharing == true, mediaReady = media != null,
            onMic = { media?.let { it.changeMuted(!it.muted) } ?: micPermission.launch(Manifest.permission.RECORD_AUDIO) },
            onAudio = { if (android.os.Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT) else sheet = "audio" },
            onCamera = { if (media?.camera == true) media?.stopCapture("camera") else cameraPermission.launch(Manifest.permission.CAMERA) },
            onCameraOptions = { sheet = "camera" },
            onScreen = { if (media?.sharing == true) media?.stopCapture("screen") else screenPermission.launch(context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent()) },
            onReaction = { sheet = "reactions" }, onChat = { sheet = "chat" }, onMore = { sheet = "menu" }, onLeave = onLeave,
        )
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (focused == null) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Участники · ${state.peers.size} из 8", Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                TextButton(onClick = { sheet = "invite" }, enabled = state.peers.size < 8) { Icon(Icons.Outlined.PersonAdd, null, Modifier.size(16.dp)); Text("Добавить", Modifier.padding(start = 6.dp), fontSize = 12.sp) }
            }
            if (feedback.isNotBlank() || media?.error?.isNotBlank() == true) Text(feedback.ifBlank { media?.error.orEmpty() }, color = MobileDesign.red, fontSize = 12.sp)
            CallParticipants(state.peers, state.selfId, media, videoMode, focused, { focused = it }, Modifier.weight(1f))
        }
    }
    if (sheet != null) ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = Color(0xFF081725)) {
        Column(Modifier.fillMaxWidth().padding(20.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (sheet) {
                "camera" -> {
                    Text("Камера", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    TextButton(enabled = media != null, onClick = { sheet = null; if (media?.camera == true) media?.stopCapture("camera") else cameraPermission.launch(Manifest.permission.CAMERA) }) {
                        Text(if (media?.camera == true) "Выключить камеру" else "Включить камеру")
                    }
                    TextButton(enabled = media?.camera == true, onClick = { media?.switchCamera(); sheet = null }) { Text("Переключить переднюю / заднюю камеру") }
                }
                "menu" -> {
                    Text("Функции звонка", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    TextButton(onClick = { sheet = "camera" }) { Text("Камера и переключение объектива") }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("Зеркалить свою камеру", Modifier.weight(1f)); Switch(MobilePreferences.mirrorSelf, { MobilePreferences.mirrorSelf = it; MobilePreferences.save(context) }) }
                    TextButton(onClick = { sheet = "chat" }) { Text("Чат комнаты · ${state.messages.size}") }
                    TextButton(onClick = { sheet = "reactions" }) { Text("Отправить реакцию") }
                    TextButton(onClick = { if (android.os.Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT) else sheet = "audio" }) { Text("Выбрать устройство звука") }
                    TextButton(enabled = media != null, onClick = {
                        sheet = null
                        if (media?.sharing == true) media?.stopCapture("screen")
                        else screenPermission.launch(context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
                    }) { Text(if (media?.sharing == true) "Остановить показ экрана" else "Показать экран") }
                    TextButton(onClick = { sheet = "invite" }) { Text("Пригласить друзей") }
                }
                "audio" -> {
                    Text("Выход звука", fontWeight = FontWeight.Bold)
                    media?.routes()?.forEach { (id, name) -> TextButton(onClick = { media?.route(id); sheet = null }) { Text(name) } }
                    if (media == null) Text("Сначала разрешите доступ к микрофону")
                }
                "reactions" -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    listOf("👍", "❤️", "😂", "🎉", "🔥").forEach { emoji -> TextButton(onClick = {
                        if (!signaling.send(JSONObject().put("type", "reaction").put("id", UUID.randomUUID().toString()).put("reaction", emoji))) feedback = "Нет соединения"
                        sheet = null
                    }) { Text(emoji, fontSize = 27.sp) } }
                }
                "invite" -> {
                    Text("Пригласить в звонок", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    TextButton(onClick = { context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Приглашение Trlka", link)); feedback = "Ссылка скопирована"; sheet = null }) { Text("Скопировать ссылку") }
                    TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Пригласить в звонок")) }) { Text("Поделиться ссылкой…") }
                    LazyColumn(Modifier.heightIn(max = 300.dp)) {
                        item { Text("Друзья", color = secondary) }
                        items(friends, key = { "friend:${it.id}" }) { friend ->
                            TextButton(enabled = !pendingInvite, onClick = { pendingInvite = true; scope.launch {
                                runCatching { api.inviteToCall(roomId, listOf(friend.id)) }.onSuccess { feedback = "Приглашение в звонок отправлено"; sheet = null }.onFailure { feedback = it.message ?: "Не удалось отправить" }
                                pendingInvite = false
                            } }) { Text(friend.displayName) }
                        }
                        item { Text("Чаты и группы", color = secondary) }
                        items(chats, key = { it.id }) { chat ->
                        val invitees = chat.members.map { it.id }.filter { it != user.id && state.peers.none { peer -> peer.id == it } }
                        TextButton(enabled = !pendingInvite && invitees.isNotEmpty(), onClick = { pendingInvite = true; scope.launch { runCatching { api.inviteToCall(roomId, invitees) }.onSuccess { feedback = "Участники приглашены"; sheet = null }.onFailure { feedback = it.message ?: "Не удалось отправить" }; pendingInvite = false } }) { Text(chat.displayTitle(user.id)) }
                    } }
                }
                "chat" -> {
                    var draft by remember { mutableStateOf("") }
                    val list = rememberLazyListState()
                    LaunchedEffect(state.messages.size) { if (state.messages.isNotEmpty()) list.animateScrollToItem(state.messages.lastIndex) }
                    Text("Чат комнаты", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    LazyColumn(Modifier.heightIn(max = 360.dp).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(8.dp)) { items(state.messages, key = { it.id }) { message ->
                        val mine = message.name == user.displayName
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                            Surface(color = if (mine) Color(0xFF1A2C48) else Color(0xFF101E2E), shape = RoundedCornerShape(topStart = 17.dp, topEnd = 17.dp, bottomStart = if (mine) 17.dp else 5.dp, bottomEnd = if (mine) 5.dp else 17.dp), border = BorderStroke(1.dp, Color(0xFF29384E))) {
                                Column(Modifier.widthIn(max = 285.dp).padding(horizontal = 13.dp, vertical = 9.dp)) {
                                    if (!mine) Text(message.name, color = cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    Text(message.text)
                                }
                            }
                        }
                    } }
                    if (state.messages.isEmpty()) Text("Пока нет сообщений", color = secondary)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(draft, { if (it.length <= 2000) draft = it }, modifier = Modifier.weight(1f), placeholder = { Text("Сообщение") }, maxLines = 4, shape = RoundedCornerShape(16.dp))
                        IconButton(enabled = draft.isNotBlank(), onClick = { if (signaling.send(JSONObject().put("type", "room-chat-message").put("id", UUID.randomUUID().toString()).put("text", draft.trim()))) draft = "" else feedback = "Нет соединения" }, modifier = Modifier.padding(start = 7.dp).background(cyan, RoundedCornerShape(14.dp))) { Icon(Icons.AutoMirrored.Outlined.Send, "Отправить", tint = Color(0xFF02101A)) }
                    }
                }
            }
        }
    }
}

@Composable
internal fun RoomVideo(track: org.webrtc.VideoTrack, engine: NativeCallMedia, mirror: Boolean, modifier: Modifier = Modifier) {
    key(track.id()) {
        AndroidView(
            factory = { ctx ->
                SurfaceViewRenderer(ctx).apply {
                    init(engine.egl.eglBaseContext, null)
                    setEnableHardwareScaler(true)
                    setMirror(mirror)
                    track.addSink(this)
                }
            },
            modifier = modifier.background(Color.Black),
            update = { it.setMirror(mirror) },
            onRelease = { renderer -> runCatching { track.removeSink(renderer) }; renderer.release() },
        )
    }
}
