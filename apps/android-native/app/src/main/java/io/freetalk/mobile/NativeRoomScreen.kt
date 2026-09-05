package io.freetalk.mobile

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
    chats: List<ChatSummary>, friends: List<FriendSummary>, onLeave: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = signaling.room
    var media by remember { mutableStateOf<NativeCallMedia?>(null) }
    var sheet by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf("") }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var pendingInvite by remember { mutableStateOf(false) }
    val cyan = Color(0xFF4EF3F2)
    val secondary = Color(0xFF8D9FB3)
    val link = "https://freetalk.191-44-38-60.sslip.io/join/$roomId"
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
    Scaffold(containerColor = Color(0xFF04111D), topBar = {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.freetalk_mascot), null, Modifier.size(36.dp))
            Text("FreeTalk", fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.weight(1f).padding(start = 8.dp))
            Text("Голосовая комната", color = secondary, fontSize = 12.sp)
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
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("Участники", fontSize = 26.sp, fontWeight = FontWeight.Bold); Text("${state.peers.size} из 8", color = secondary, fontSize = 12.sp) }
                    Text(if (state.startedAt > 0) "%02d:%02d".format(elapsed / 60, elapsed % 60) else "Подключение…", color = cyan)
                }
                Text("Комната · $roomId", color = secondary, fontSize = 12.sp)
            }
            items(state.peers, key = { it.id }) { peer ->
                val self = peer.id == state.selfId
                val off = if (self) media?.muted != false else peer.muted
                val talking = !off && media?.speaking?.contains(peer.id) == true
                Surface(color = Color(0xFF061624), shape = RoundedCornerShape(22.dp), border = BorderStroke(1.dp, if (talking) cyan else Color(0xFF193345))) {
                    Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(if (state.peers.size == 1) 86.dp else 58.dp).clip(CircleShape).background(Color(0xFF10354A)), contentAlignment = Alignment.Center) {
                            if (peer.avatar != null) AsyncImage(peer.avatar, peer.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                            else Text(peer.name.take(1), fontSize = 26.sp)
                        }
                        Text(peer.name + if (self) " · Вы" else "", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        if (peer.owner) Text("♛ Создатель комнаты", color = cyan, fontSize = 12.sp)
                        Text(when { off -> "Микрофон выключен"; talking -> "Говорит"; self -> "Слушает"; media?.connections?.get(peer.id) == "Подключён" -> "Слушает"; else -> media?.connections?.get(peer.id) ?: "Подключение…" }, color = if (talking) cyan else secondary, fontSize = 12.sp)
                        VoiceLevelIndicator(level = if (off) 0f else media?.levels?.get(peer.id) ?: 0f, speaking = talking, modifier = Modifier.padding(top = 8.dp))
                        val reactions = state.reactions.filter { it.peerId == peer.id && now - it.at < 2850 }
                        if (reactions.isNotEmpty()) Text(reactions.joinToString(" ") { it.emoji }, fontSize = 26.sp)
                    }
                }
            }
            media?.videos?.toList()?.forEach { (key, track) ->
                item(key = "video:$key") {
                    val engine = media!!
                    Text(if (key == "self:screen") "Ваш экран" else if (key == "self:camera") "Ваша камера" else "Видео участника", color = secondary, fontSize = 12.sp)
                    AndroidView(factory = { ctx -> SurfaceViewRenderer(ctx).apply { init(engine.egl.eglBaseContext, null); setEnableHardwareScaler(true); track.addSink(this) } },
                        modifier = Modifier.fillMaxWidth().height(220.dp), onRelease = { runCatching { track.removeSink(it) }; it.release() })
                }
            }
            item { OutlinedButton(onClick = { sheet = "invite" }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonAdd, null); Text("Добавить друзей · ${(8 - state.peers.size).coerceAtLeast(0)} мест") } }
            item { if (feedback.isNotBlank()) Text(feedback, color = cyan); if (media?.error?.isNotBlank() == true) Text(media!!.error, color = Color(0xFFFF647C)); if (status != "Комната создана") Text(status, color = secondary, fontSize = 12.sp) }
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
                    TextButton(onClick = { context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Приглашение FreeTalk", link)); feedback = "Ссылка скопирована"; sheet = null }) { Text("Скопировать ссылку") }
                    TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Пригласить в звонок")) }) { Text("Поделиться ссылкой…") }
                    LazyColumn(Modifier.heightIn(max = 300.dp)) {
                        item { Text("Друзья", color = secondary) }
                        items(friends, key = { "friend:${it.id}" }) { friend ->
                            TextButton(enabled = !pendingInvite, onClick = { pendingInvite = true; scope.launch {
                                runCatching { api.inviteFriend(friend.id, link) }.onSuccess { feedback = "Приглашение отправлено"; sheet = null }.onFailure { feedback = it.message ?: "Не удалось отправить" }
                                pendingInvite = false
                            } }) { Text(friend.displayName) }
                        }
                        item { Text("Чаты и группы", color = secondary) }
                        items(chats, key = { it.id }) { chat ->
                        TextButton(enabled = !pendingInvite, onClick = { pendingInvite = true; scope.launch { runCatching { api.sendMessage(chat.id, link) }.onSuccess { feedback = "Приглашение отправлено"; sheet = null }.onFailure { feedback = it.message ?: "Не удалось отправить" }; pendingInvite = false } }) { Text(chat.displayTitle(user.id)) }
                    } }
                }
                "chat" -> {
                    var draft by remember { mutableStateOf("") }
                    val list = rememberLazyListState()
                    LaunchedEffect(state.messages.size) { if (state.messages.isNotEmpty()) list.animateScrollToItem(state.messages.lastIndex) }
                    Text("Чат комнаты", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    LazyColumn(Modifier.heightIn(max = 330.dp), state = list) { items(state.messages, key = { it.id }) { message ->
                        Column(Modifier.padding(vertical = 6.dp)) { Text(message.name, color = cyan, fontSize = 12.sp); Text(message.text) }
                    } }
                    if (state.messages.isEmpty()) Text("Пока нет сообщений", color = secondary)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(draft, { if (it.length <= 2000) draft = it }, modifier = Modifier.weight(1f), placeholder = { Text("Сообщение") }, maxLines = 4)
                        IconButton(enabled = draft.isNotBlank(), onClick = { if (signaling.send(JSONObject().put("type", "room-chat-message").put("id", UUID.randomUUID().toString()).put("text", draft.trim()))) draft = "" else feedback = "Нет соединения" }) { Icon(Icons.AutoMirrored.Outlined.Send, "Отправить") }
                    }
                }
            }
        }
    }
}
