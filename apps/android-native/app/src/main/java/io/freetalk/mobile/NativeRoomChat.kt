package io.freetalk.mobile

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeRoomChat(signaling: RoomSignaling) {
    val state = signaling.room
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val files = remember(signaling.fileOrigin, state.fileToken) { runCatching { RoomFiles(signaling.fileOrigin!!, state.fileToken!!) }.getOrNull() }
    var draft by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf<RoomText?>(null) }
    var editing by remember { mutableStateOf<RoomText?>(null) }
    var target by remember { mutableStateOf<RoomText?>(null) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var download by remember { mutableStateOf<RoomFile?>(null) }
    var downloaded by remember { mutableStateOf(emptySet<String>()) }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (state.messages.size - 1).coerceAtLeast(0))
    LaunchedEffect(state.messages.size) { if (state.messages.isNotEmpty()) list.scrollToItem(state.messages.lastIndex) }
    fun action(kind: String, message: RoomText, emoji: String? = null) {
        val value = JSONObject().put("type", "room-chat-action").put("action", JSONObject().put("kind", kind).put("id", message.id).apply { if (emoji != null) put("emoji", emoji) })
        if (!signaling.send(value)) error = "Нет соединения"
    }
    fun send(text: String, file: RoomFile? = null): Boolean {
        val j = JSONObject().put("type", "room-chat-message").put("id", UUID.randomUUID().toString()).put("text", text)
        file?.let { j.put("attachmentId", it.id) }
        reply?.let { j.put("replyTo", it.id) }
        return signaling.send(j)
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && !busy && files != null) {
            busy = true
            scope.launch {
                runCatching { val file = files.upload(context, uri); check(send(draft.trim().ifBlank { file.name }, file)) { "Нет соединения" } }
                    .onSuccess { draft = ""; reply = null }.onFailure { error = it.message ?: "Не удалось загрузить файл" }
                busy = false
            }
        }
    }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val file = download
        if (uri != null && file != null && files != null) scope.launch {
            runCatching { context.contentResolver.openOutputStream(uri)?.use { files.save(file.id, it) } ?: error("Файл недоступен") }
                .onSuccess { downloaded = downloaded + file.id }.onFailure { error = it.message ?: "Не удалось сохранить файл" }
            download = null
        } else download = null
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MobileText("Чат комнаты", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        MobileText("Исчезнет после завершения звонка", color = MobileDesign.muted, fontSize = 11.sp)
        LazyColumn(Modifier.heightIn(min = 100.dp, max = 330.dp).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(9.dp)) {
            items(state.messages, key = { it.id }) { message ->
                val mine = message.participantId == state.selfId
                Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                        if (!mine) MobileAvatar(message.name, message.avatar, 26.dp)
                        Surface(color = if (mine) MobileDesign.outgoing else MobileDesign.incoming, shape = RoundedCornerShape(13.dp), border = BorderStroke(1.dp, MobileDesign.stroke),
                            modifier = Modifier.widthIn(max = 270.dp).combinedClickable(onClick = {}, onLongClick = { if (!message.deleted) target = message })) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                if (!mine) MobileText(message.name, localize = false, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MobileDesign.accent)
                                message.replyTo?.let { id -> state.messages.find { it.id == id }?.let { MobileText(it.text.take(60), localize = false, fontSize = 11.sp, color = MobileDesign.muted) } }
                                if (!message.deleted) message.attachment?.let { file ->
                                    if (file.image && files != null) RoomFileImage(files, file)
                                    TextButton(enabled = download == null, onClick = { download = file; saver.launch(file.name) }, contentPadding = PaddingValues(0.dp)) {
                                        Icon(if (file.id in downloaded) Icons.Outlined.Check else Icons.Outlined.Download, null, Modifier.size(18.dp))
                                        MobileText(file.name, localize = false, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp))
                                    }
                                }
                                MobileText(if (message.deleted) "Сообщение удалено" else message.text, localize = message.deleted, color = MobileDesign.text, fontSize = 14.sp)
                            }
                        }
                        if (mine) MobileAvatar(message.name, message.avatar, 26.dp)
                    }
                    if (!message.deleted && message.reactions.isNotEmpty()) Row(Modifier.padding(start = if (mine) 0.dp else 32.dp, end = if (mine) 32.dp else 0.dp, top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        message.reactions.forEach { reaction ->
                            Surface(onClick = { action("react", message, reaction.emoji) }, color = if (reaction.mine) MobileDesign.outgoing else MobileDesign.incoming, shape = RoundedCornerShape(9.dp)) {
                                MobileText("${reaction.emoji} ${reaction.count}", localize = false, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp))
                            }
                        }
                    }
                }
            }
        }
        if (error.isNotBlank()) MobileText(error, color = MobileDesign.red, fontSize = 12.sp)
        if (reply != null || editing != null) Row(verticalAlignment = Alignment.CenterVertically) {
            MobileText((editing ?: reply)!!.text.take(70), localize = false, fontSize = 12.sp, modifier = Modifier.weight(1f), color = MobileDesign.muted)
            IconButton(onClick = { reply = null; editing = null; draft = "" }, Modifier.size(30.dp)) { Icon(Icons.Outlined.Close, "Отмена", Modifier.size(16.dp)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            IconButton(enabled = !busy && editing == null && files != null, onClick = { picker.launch(arrayOf("*/*")) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.AttachFile, "Прикрепить файл") }
            OutlinedTextField(draft, { if (it.length <= 2000) draft = it }, enabled = !busy, modifier = Modifier.weight(1f), placeholder = { MobileText("Сообщение", fontSize = 13.sp) }, maxLines = 3, shape = RoundedCornerShape(14.dp))
            IconButton(enabled = !busy && draft.isNotBlank(), onClick = {
                val ok = if (editing != null) signaling.send(JSONObject().put("type", "room-chat-action").put("action", JSONObject().put("kind", "edit").put("id", editing!!.id).put("text", draft.trim()))) else send(draft.trim())
                if (ok) { draft = ""; reply = null; editing = null } else error = "Нет соединения"
            }) { if (busy) CircularProgressIndicator(Modifier.size(20.dp)) else Icon(Icons.AutoMirrored.Outlined.Send, "Отправить") }
        }
    }
    target?.let { message -> AlertDialog(onDismissRequest = { target = null }, confirmButton = {}, containerColor = MobileDesign.canvas, text = {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row { listOf("❤️", "👍", "😂", "😮", "🔥").forEach { emoji -> TextButton(onClick = { action("react", message, emoji); target = null }, contentPadding = PaddingValues(3.dp), modifier = Modifier.weight(1f)) { MobileText(emoji, localize = false, fontSize = 20.sp) } } }
            TextButton(onClick = { reply = message; editing = null; target = null }) { MobileText("Ответить") }
            TextButton(onClick = { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("", message.text)); target = null }) { MobileText("Копировать текст") }
            if (message.participantId == state.selfId) {
                TextButton(onClick = { editing = message; reply = null; draft = message.text; target = null }) { MobileText("Изменить") }
                TextButton(onClick = { action("delete", message); target = null }) { MobileText("Удалить", color = MobileDesign.red) }
            }
        }
    }) }
}

@Composable
private fun RoomFileImage(files: RoomFiles, file: RoomFile) {
    var bytes by remember(file.id) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(file.id) { bytes = runCatching { files.image(file.id) }.getOrNull() }
    bytes?.let { AsyncImage(ImageRequest.Builder(LocalContext.current).data(it).diskCachePolicy(CachePolicy.DISABLED).memoryCachePolicy(CachePolicy.DISABLED).build(), file.name, modifier = Modifier.fillMaxWidth().heightIn(max = 170.dp), contentScale = ContentScale.Fit) }
}
