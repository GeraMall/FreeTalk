package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun NativeChatScreen(api: FreeTalkApi, cache: MediaCache, user: SignedInUser, chat: ChatSummary, onBack: () -> Unit, onChanged: () -> Unit) {
    var messages by remember(chat.id) { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember(chat.id) { mutableStateOf(true) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var input by remember(chat.id) { mutableStateOf("") }
    var viewer by remember { mutableStateOf<ChatMessage?>(null) }
    val scope = rememberCoroutineScope()
    val mutex = remember(chat.id) { Mutex() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(chat.id, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            api.chatEvents.onStart { emit(org.json.JSONObject().put("type", "ready")) }.collect { event ->
                if (event.optString("type") == "disconnected") {
                    error = "Соединение потеряно. Переподключаемся…"
                    return@collect
                }
                if (event.optString("type") != "ready" && event.optString("chatId") != chat.id) return@collect
                mutex.withLock {
                    if (event.optString("type") == "message-created" && !loading) {
                        event.optJSONObject("message")?.let {
                            messages = (messages + api.parseMessage(it)).distinctBy { message -> message.id }
                            error = ""
                        }
                        return@withLock
                    }
                    try { messages = api.loadMessages(chat.id); error = "" }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message ?: "Не удалось загрузить сообщения" }
                    finally { loading = false }
                }
            }
        }
    }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(Color(0xFF010811)).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Назад") }
            ChatAvatar(chat.avatarUrl ?: chat.members.firstOrNull { it.id != user.id }?.avatarUrl, chat.displayTitle(user.id))
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(chat.displayTitle(user.id), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Переписка", color = Color(0xFF8195AC), fontSize = 12.sp)
            }
        }
        HorizontalDivider(color = Color(0xFF102839))
        if (error.isNotBlank()) Text(error, color = Color(0xFFFF8096), modifier = Modifier.padding(12.dp), fontSize = 12.sp)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), reverseLayout = true, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (loading) item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
            if (!loading && messages.isEmpty()) item { Text("Начните разговор", color = Color(0xFF8195AC), modifier = Modifier.padding(24.dp)) }
            items(messages.asReversed(), key = { it.id }) { message ->
                val mine = message.senderId == user.id
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Bottom) {
                    if (!mine) { ChatAvatar(message.avatarUrl, message.senderName); Spacer(Modifier.width(8.dp)) }
                    Column(Modifier.widthIn(max = 280.dp).weight(1f, fill = false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                        if (!mine) Text(message.senderName, color = Color(0xFF86DDE8), fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp))
                        Surface(color = if (mine) Color(0xFF0C2E42) else Color(0xFF061421), shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, Color(0xFF173B4C))) {
                            Column {
                                if (message.kind == "image") CachedChatPhoto(api, cache, user.id, message, false) { viewer = message }
                                if (message.body.isNotBlank()) SelectionContainer { Text(message.body, modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp), fontSize = 14.sp) }
                            }
                        }
                        Text(chatDate(message.createdAt), color = Color(0xFF71859B), fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                    if (mine) { Spacer(Modifier.width(8.dp)); ChatAvatar(user.avatarUrl, user.displayName) }
                }
            }
        }
        HorizontalDivider(color = Color(0xFF102839))
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(input, { input = it.take(4000) }, placeholder = { Text("Написать сообщение…", fontSize = 14.sp) }, modifier = Modifier.weight(1f), maxLines = 4, shape = RoundedCornerShape(15.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Color(0xFF48DADF), unfocusedBorderColor = Color(0xFF173B4C)))
            IconButton(onClick = {
                val body = input.trim()
                if (body.isNotEmpty() && !sending) {
                    sending = true
                    scope.launch {
                        try {
                            mutex.withLock {
                                val sent = api.sendMessage(chat.id, body)
                                messages = (messages + sent).distinctBy { it.id }
                                if (input.trim() == body) input = ""
                                error = ""
                            }
                            onChanged()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { error = e.message ?: "Не отправлено" }
                        finally { sending = false }
                    }
                }
            }, enabled = !sending && input.isNotBlank(), modifier = Modifier.padding(start = 8.dp, bottom = 4.dp).background(Color(0xFF163D4A), RoundedCornerShape(13.dp))) {
                if (sending) CircularProgressIndicator(Modifier.size(20.dp)) else Icon(Icons.AutoMirrored.Outlined.Send, "Отправить")
            }
        }
    }
    viewer?.let { message ->
        Dialog(onDismissRequest = { viewer = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color(0xF5010811)), contentAlignment = Alignment.Center) {
                CachedChatPhoto(api, cache, user.id, message, true) {}
                IconButton(onClick = { viewer = null }, modifier = Modifier.align(Alignment.TopEnd).safeDrawingPadding()) { Icon(Icons.Outlined.Close, "Закрыть", tint = Color.White) }
            }
        }
    }
}

@Composable
private fun CachedChatPhoto(api: FreeTalkApi, cache: MediaCache, accountId: String, message: ChatMessage, full: Boolean, onClick: () -> Unit) {
    var bytes by remember(message.id, full) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(message.id, full) { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var decoding by remember(message.id, full) { mutableStateOf(true) }
    LaunchedEffect(message.id, full, attempt) {
        failed = false; decoding = true
        try {
            val expires = message.expiresAt?.let { Instant.parse(it).toEpochMilli() }
            bytes = cache.image(accountId, message.id, full, expires) { api.downloadChatImage(message.id, full) }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { failed = true }
    }
    val ratio = if (message.width > 0 && message.height > 0) (message.width.toFloat() / message.height).coerceIn(0.6f, 2f) else 1.5f
    val modifier = if (full) Modifier.fillMaxSize().padding(16.dp) else Modifier.fillMaxWidth().aspectRatio(ratio)
    Box(modifier.background(Color(0xFF071827)).clickable(enabled = bytes != null && !failed && !full, onClick = onClick), contentAlignment = Alignment.Center) {
        if (bytes != null) AsyncImage(
            model = ImageRequest.Builder(LocalContext.current).data(bytes).memoryCachePolicy(CachePolicy.DISABLED).diskCachePolicy(CachePolicy.DISABLED).build(),
            contentDescription = "Фотография", contentScale = if (full) ContentScale.Fit else ContentScale.Crop, modifier = Modifier.matchParentSize(),
            onSuccess = { decoding = false }, onError = { failed = true },
        )
        if (failed) TextButton(onClick = { bytes = null; attempt++ }) { Text("Фото не загрузилось · Повторить") }
        else if (bytes == null || decoding) CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.dp)
    }
}

@Composable
private fun ChatAvatar(url: String?, name: String) {
    Box(Modifier.size(30.dp).clip(CircleShape).background(Color(0xFF153547)), contentAlignment = Alignment.Center) {
        if (url != null) AsyncImage(url, name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(name.take(1).uppercase(), fontSize = 12.sp, color = Color(0xFF77E5E8))
    }
}

private fun chatDate(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("dd.MM · HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrDefault("")
