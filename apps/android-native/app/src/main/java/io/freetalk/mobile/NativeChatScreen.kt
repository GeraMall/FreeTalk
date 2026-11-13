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
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.AccountBox
import androidx.compose.material.icons.outlined.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.flow.distinctUntilChanged
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
internal fun NativeChatScreen(
    api: FreeTalkApi,
    cache: MediaCache,
    user: SignedInUser,
    chat: ChatSummary,
    onBack: () -> Unit,
    onChanged: () -> Unit,
    onStartCall: () -> Unit,
    onJoinCall: (String) -> Unit,
    preview: List<ChatMessage>? = null,
    reading: Boolean = true,
) {
    var messages by remember(chat.id) { mutableStateOf(preview ?: api.cachedMessages(chat.id).orEmpty()) }
    var loading by remember(chat.id) { mutableStateOf(preview == null && api.cachedMessages(chat.id) == null) }
    var hasEarlier by remember(chat.id) { mutableStateOf(false) }
    var loadingEarlier by remember(chat.id) { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var input by remember(chat.id) { mutableStateOf("") }
    var viewer by remember { mutableStateOf<ChatMessage?>(null) }
    var activeCall by remember(chat.id) { mutableStateOf<ActiveCall?>(null) }
    var showProfile by remember { mutableStateOf(false) }
    var actionTarget by remember(chat.id) { mutableStateOf<ChatMessage?>(null) }
    var replyTo by remember(chat.id) { mutableStateOf<ChatMessage?>(null) }
    var editTarget by remember(chat.id) { mutableStateOf<ChatMessage?>(null) }
    var forwardTargets by remember(chat.id) { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var forwardDestination by remember(chat.id) { mutableStateOf<ChatSummary?>(null) }
    var forwarding by remember { mutableStateOf(false) }
    var forwardingChats by remember { mutableStateOf(emptyList<ChatSummary>()) }
    var readers by remember { mutableStateOf<List<ChatReader>?>(null) }
    var downloaded by remember(chat.id) { mutableStateOf(emptySet<String>()) }
    var downloading by remember { mutableStateOf<String?>(null) }
    var selected by remember(chat.id) { mutableStateOf(emptySet<String>()) }
    var chooseGif by remember(chat.id) { mutableStateOf(false) }
    var favorites by remember(chat.id) { mutableStateOf<List<ChatGif>?>(null) }
    var gifError by remember(chat.id) { mutableStateOf(false) }
    var favoriteAttempt by remember(chat.id) { mutableIntStateOf(0) }
    var typingPeers by remember(chat.id) { mutableStateOf(emptyMap<String, Pair<String, Long>>()) }
    var typingClock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var peerProfile by remember(chat.id) { mutableStateOf(chat.members.firstOrNull { it.id != user.id }?.let { api.cachedProfile(it.id) }) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val clipboard = context.getSystemService(android.content.ClipboardManager::class.java)
    fun sendGif(getGif: suspend () -> ChatGif) {
        if (sending) return
        val replyId = replyTo?.id
        sending = true
        chooseGif = false
        scope.launch {
            try {
                val sent = api.sendGif(chat.id, getGif(), replyId)
                messages = (messages + sent).distinctBy { it.id }
                replyTo = null
                error = ""
                onChanged()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Не удалось отправить GIF" }
            finally { sending = false }
        }
    }
    val gifUpload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) sendGif { uploadPickedGif(context, uri, api) }
    }
    fun toggleReaction(message: ChatMessage, emoji: String) {
        scope.launch {
            try {
                val latest = api.react(message.id, emoji, message.reactions.any { it.emoji == emoji && it.mine })
                messages = messages.map { if (it.id == message.id) it.copy(reactions = latest) else it }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message.orEmpty() }
        }
    }
    val attachment = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && !sending) {
            sending = true
            val caption = input
            scope.launch {
                try {
                    val sent = uploadPickedAttachment(context, api, uri, chat.id, caption, replyTo?.id)
                    messages = (messages + sent).distinctBy { it.id }
                    if (input == caption) input = ""
                    replyTo = null; onChanged()
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { error = e.message ?: "Не удалось отправить файл" }
                finally { sending = false }
            }
        }
    }
    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val id = downloading
        if (uri == null || id == null) downloading = null
        else scope.launch {
            try {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { api.saveAttachment(id, it) } ?: error("Не удалось сохранить файл")
                }
                downloaded = downloaded + id
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Не удалось скачать файл" }
            finally { downloading = null }
        }
    }
    val mutex = remember(chat.id) { Mutex() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(chat.id, lifecycle) {
        if (preview != null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            api.chatEvents.onStart { emit(org.json.JSONObject().put("type", "ready")) }.collect { event ->
                if (event.optString("type") == "disconnected") {
                    error = "Соединение потеряно. Переподключаемся…"
                    return@collect
                }
                if (event.optString("type") != "ready" && event.optString("chatId") != chat.id) return@collect
                when (event.optString("type")) {
                    "chat-typing" -> {
                        typingPeers = typingPeers + (event.optString("userId") to (event.optString("name") to event.optLong("expiresAt")))
                        return@collect
                    }
                    "chat-reads" -> return@collect
                    "message-reactions-updated" -> {
                        messages = messages.map { if (it.id != event.optString("messageId")) it else it.copy(reactions = api.parseReactions(event.optJSONArray("reactions"))) }
                        return@collect
                    }
                    "message-deleted" -> {
                        messages = messages.filterNot { it.id == event.optString("messageId") }
                        return@collect
                    }
                    "message-updated" -> {
                        messages = messages.map { if (it.id != event.optString("messageId")) it else it.updatedBy(event) }
                        return@collect
                    }
                }
                mutex.withLock {
                    if (event.optString("type") == "message-created" && !loading) {
                        event.optJSONObject("message")?.let {
                            messages = (messages + api.parseMessage(it)).distinctBy { message -> message.id }
                            error = ""
                        }
                        return@withLock
                    }
                    try {
                        val page = api.loadMessages(chat.id)
                        val oldestLoaded = page.messages.firstOrNull()?.let { first -> messages.indexOfFirst { it.id == first.id } } ?: -1
                        if (page.hasMore && oldestLoaded > 0) {
                            // Keep older pages and the user's reading position across a reconnect.
                            messages = messages.take(oldestLoaded) + page.messages
                        } else {
                            messages = page.messages
                            hasEarlier = page.hasMore
                        }
                        error = ""
                    }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message ?: "Не удалось загрузить сообщения" }
                    finally { loading = false }
                }
            }
        }
    }
    LaunchedEffect(chat.id, input.isNotBlank(), reading, lifecycle) {
        if (preview != null || chat.isSaved) return@LaunchedEffect
        if (input.isBlank() || !reading) { runCatching { api.typing(chat.id, false) }; return@LaunchedEffect }
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { runCatching { api.typing(chat.id, true) }; delay(2500) }
        }
    }
    LaunchedEffect(chat.id, typingPeers, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            typingClock = System.currentTimeMillis()
            val nextExpiry = typingPeers.values.minOfOrNull { it.second }
            if (nextExpiry != null) {
                delay((nextExpiry - typingClock).coerceAtLeast(0))
                typingClock = System.currentTimeMillis()
                typingPeers = typingPeers.filterValues { it.second > typingClock }
            }
        }
    }
    LaunchedEffect(chat.id, lifecycle, reading) {
        if (preview != null || chat.isSaved || !reading) return@LaunchedEffect
        val recorded = mutableSetOf<String>()
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.mapNotNull { it.key as? String } }.distinctUntilChanged().collect {
                delay(350)
                val visible = listState.layoutInfo.visibleItemsInfo.mapNotNull { it.key as? String }.toSet()
                val ids = messages.filter { it.id in visible && it.id !in recorded && it.senderId != user.id }.take(50).map { it.id }
                if (ids.isNotEmpty()) runCatching { api.markRead(chat.id, ids) }.onSuccess { recorded.addAll(ids) }
            }
        }
    }
    LaunchedEffect(chat.id, lifecycle, reading) {
        if (preview != null || !reading || chat.isSaved) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                runCatching { api.activeCall(chat.id) }.onSuccess { activeCall = it }
                delay(3_000)
            }
        }
    }
    BackHandler { if (selected.isNotEmpty()) selected = emptySet() else onBack() }
    Column(Modifier.fillMaxSize().background(MobileDesign.background).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(MobileDesign.header).padding(horizontal = 8.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Назад") }
            ChatAvatar(chat.avatarUrl ?: chat.members.firstOrNull { it.id != user.id }?.avatarUrl, chat.displayTitle(user.id))
            Column(Modifier.weight(1f).clickable { showProfile = true }.padding(start = 10.dp)) {
                MobileText(chat.displayTitle(user.id), localize = chat.isSaved, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MobileText(if (chat.type == "group") "${chat.members.size} участников" else "@${chat.members.firstOrNull { it.id != user.id }?.username.orEmpty()}", color = MobileDesign.muted, fontSize = 12.sp)
            }
            if (!chat.isSaved) IconButton(onClick = { activeCall?.let { onJoinCall(it.roomId) } ?: onStartCall() }, modifier = Modifier.background(Color(0xFF0B2B39), CircleShape)) {
                Icon(Icons.Outlined.Call, if (activeCall == null) "Начать звонок" else "Вернуться в звонок", tint = Color(0xFF55EFB7))
            }
            IconButton(onClick = { showProfile = true }) { Icon(Icons.Outlined.AccountBox, "Профиль собеседника") }
        }
        if (selected.isNotEmpty()) Row(Modifier.fillMaxWidth().background(MobileDesign.incoming).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            MobileText("${selected.size} выбрано", Modifier.weight(1f))
            IconButton(onClick = { clipboard.setPrimaryClip(android.content.ClipData.newPlainText("TRLKA", messages.filter { it.id in selected }.joinToString("\n\n") { it.body })) }) { Icon(Icons.Outlined.ContentCopy, "Копировать") }
            IconButton(onClick = { forwardTargets = messages.filter { it.id in selected } }) { Icon(Icons.AutoMirrored.Outlined.Send, "Переслать") }
            IconButton(onClick = { selected = emptySet() }) { Icon(Icons.Outlined.Close, "Отмена") }
        }
        HorizontalDivider(color = Color(0xFF102839))
        activeCall?.let { call ->
            Surface(
                onClick = { onJoinCall(call.roomId) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                color = Color(0xFF0A2232),
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(1.dp, Color(0xFF1B5664)),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(70.dp).height(48.dp)) {
                        call.participants.take(2).forEachIndexed { index, person ->
                            Box(Modifier.offset(x = (index * 25).dp).size(46.dp).clip(RoundedCornerShape(15.dp)).background(Color(0xFF12384D)).border(2.dp, Color(0xFF0A2232), RoundedCornerShape(15.dp)), contentAlignment = Alignment.Center) {
                                if (person.avatarUrl != null) AsyncImage(person.avatarUrl, person.displayName, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                else MobileText(person.displayName.take(1).uppercase(), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        MobileText("Идёт звонок", color = Color(0xFF55EFB7), fontWeight = FontWeight.Bold)
                        MobileText(call.participants.joinToString { it.displayName }.ifBlank { call.title }, color = Color(0xFF9AABC1), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    MobileText("Войти", color = Color(0xFF8DA6DC), fontWeight = FontWeight.Bold)
                }
            }
        }
        if (error.isNotBlank()) MobileText(error, color = Color(0xFFFF8096), modifier = Modifier.padding(12.dp), fontSize = 12.sp)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, reverseLayout = true, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (loading) item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
            if (!loading && messages.isEmpty()) item { MobileText("Начните разговор", color = Color(0xFF9AABC1), modifier = Modifier.padding(24.dp)) }
            items(messages.asReversed(), key = { it.id }) { message ->
                val mine = message.senderId == user.id
                if (message.kind == "call") {
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                        color = Color(0xFF071A29), shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, Color(0xFF29384E)),
                    ) {
                        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Groups, null, tint = Color(0xFF55EFB7))
                            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                MobileText(message.body.ifBlank { "Звонок Trlka" }, fontWeight = FontWeight.SemiBold)
                                MobileText(chatDate(message.createdAt), color = Color(0xFF9AABC1), fontSize = 10.sp)
                            }
                            activeCall?.takeIf { !message.callEnded && message.callRoomId == it.roomId }?.let { current ->
                                TextButton(onClick = { onJoinCall(current.roomId) }) { MobileText("Войти") }
                            }
                        }
                    }
                    return@items
                }
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val bubbleWidth = (maxWidth * .78f).coerceAtMost(640.dp)
                    Row(Modifier.fillMaxWidth().background(if (message.id in selected) MobileDesign.accent.copy(alpha = .12f) else Color.Transparent), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
                        if (!mine) { MobileAvatar(message.senderName, message.avatarUrl, 32.dp); Spacer(Modifier.width(8.dp)) }
                        Column(Modifier.widthIn(max = bubbleWidth), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                        MobileMessage(if (message.deleted) "Сообщение удалено" else if (message.gif == null) message.body else "", mobileMessageTime(message.createdAt), mine, Modifier.widthIn(max = bubbleWidth).combinedClickable(
                            onClick = { if (selected.isNotEmpty()) selected = if (message.id in selected) selected - message.id else selected + message.id },
                            onLongClick = { if (selected.isNotEmpty()) selected = selected + message.id else actionTarget = message },
                        ), onLink = { link -> roomCodeFromLink(link)?.let { onJoinCall(it); true } ?: false }, afterText = {
                            if (!message.deleted && message.gif == null && preview == null) NativeVideoPreview(api, cache, user.id, message.body)
                        }) {
                            if (chat.type == "group" && !mine) MobileText(message.senderName, localize = false, color = MobileDesign.accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            message.reply?.let { MobileText(it.take(120), localize = false, fontSize = 12.sp, color = MobileDesign.muted) }
                            if (!message.deleted) message.gif?.let { gif ->
                                NativeGifImage(gif, api, cache, user.id, true, message.expiresAt,
                                    Modifier.widthIn(max = 280.dp).fillMaxWidth().aspectRatio((gif.width.toFloat() / gif.height).coerceIn(.7f, 2.2f)))
                                val attribution = gif.attributionUrl
                                MobileText("GIF · " + gif.provider, localize = false, color = MobileDesign.muted, fontSize = 11.sp,
                                    modifier = if (attribution == null) Modifier else Modifier.clickable {
                                        runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(attribution))) }
                                    })
                            }
                            if (message.kind == "image" && !message.deleted) CachedChatPhoto(api, cache, user.id, message, false) {
                                if (selected.isEmpty()) viewer = message
                                else selected = if (message.id in selected) selected - message.id else selected + message.id
                            }
                            if (message.kind == "file" && !message.deleted) OutlinedButton(enabled = downloading == null, onClick = {
                                downloading = message.id
                                saveFile.launch(message.filename.ifBlank { "file" })
                            }) {
                                Icon(if (message.id in downloaded) Icons.Outlined.Check else Icons.Outlined.Download, "Скачать файл", Modifier.size(20.dp))
                                Column(Modifier.padding(start = 8.dp)) {
                                    MobileText(message.filename, localize = false, maxLines = 2, fontWeight = FontWeight.SemiBold)
                                    MobileText("${message.size / 1024} KB", fontSize = 11.sp, color = MobileDesign.muted)
                                }
                            }
                        }
                        if (message.reactions.isNotEmpty() && !message.deleted) FlowRow(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            message.reactions.forEach { reaction ->
                                OutlinedButton(enabled = preview == null, contentPadding = PaddingValues(horizontal = 9.dp, vertical = 0.dp), modifier = Modifier.height(30.dp), onClick = {
                                    toggleReaction(message, reaction.emoji)
                                }) { MobileText("${reaction.emoji} ${reaction.count}", localize = false, fontSize = 12.sp) }
                            }
                        }
                        }
                        if (mine) { Spacer(Modifier.width(8.dp)); MobileAvatar(user.displayName, user.avatarUrl, 32.dp) }
                    }
                }
            }
            if (hasEarlier && preview == null) item(key = "older") {
                TextButton(enabled = !loadingEarlier, onClick = {
                    if (!loadingEarlier) {
                        loadingEarlier = true
                        scope.launch {
                            try {
                                mutex.withLock {
                                    val first = messages.firstOrNull() ?: return@withLock
                                    val page = api.loadMessages(chat.id, first.createdAt)
                                    val older = page.messages.filterNot { past -> messages.any { it.id == past.id } }
                                    messages = older + messages
                                    hasEarlier = older.isNotEmpty() && page.hasMore
                                }
                            } catch (e: CancellationException) { throw e }
                            catch (e: Exception) { error = e.message.orEmpty() }
                            finally { loadingEarlier = false }
                        }
                    }
                }, modifier = Modifier.fillMaxWidth()) { MobileText(if (loadingEarlier) "Загружаем предыдущие сообщения…" else "Предыдущие сообщения") }
            }
        }
        val typing = typingPeers.values.filter { it.second > typingClock }.map { it.first }.take(2)
        androidx.compose.animation.AnimatedVisibility(typing.isNotEmpty()) {
            MobileText(MobileTranslations.text("{name} печатает…", MobilePreferences.language).replace("{name}", typing.joinToString(", ")),
                localize = false, modifier = Modifier.padding(horizontal = 16.dp, vertical = 3.dp), fontSize = 12.sp, color = MobileDesign.text)
        }
        if (replyTo != null || editTarget != null) Row(Modifier.fillMaxWidth().background(MobileDesign.incoming).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                MobileText(if (editTarget != null) "Изменить сообщение" else "Ответить", fontSize = 12.sp, color = MobileDesign.accent)
                MobileText((editTarget ?: replyTo)?.body.orEmpty().take(100), localize = false, fontSize = 12.sp, maxLines = 1)
            }
            IconButton(onClick = { replyTo = null; editTarget = null }) { Icon(Icons.Outlined.Close, "Отмена") }
        }
        MobileComposer(input, { input = it }, sending, enabled = preview == null, placeholder = "Написать сообщение…",
            onAttach = if (editTarget != null) null else ({ attachment.launch(arrayOf("*/*")) }),
            onGif = if (editTarget != null) null else ({ chooseGif = true })) {
            val body = input.trim()
            if (body.isNotEmpty() && !sending) {
                sending = true
                scope.launch {
                    try {
                        mutex.withLock {
                            val edited = editTarget
                            if (edited != null) {
                                api.editMessage(edited.id, body)
                                messages = messages.map { if (it.id == edited.id) it.copy(body = body) else it }
                            } else {
                                val sent = api.sendMessage(chat.id, body, replyTo?.id)
                                messages = (messages + sent).distinctBy { it.id }
                            }
                            replyTo = null; editTarget = null
                            if (input.trim() == body) input = ""
                            error = ""
                        }
                        onChanged()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message ?: "Не отправлено" }
                    finally { sending = false }
                }
            }
        }
    }
    actionTarget?.let { message -> ModalBottomSheet(onDismissRequest = { actionTarget = null }, containerColor = MobileDesign.canvas) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                listOf("❤️", "👍", "😂", "😮", "😢", "🔥").forEach { emoji -> TextButton(enabled = preview == null, onClick = {
                    actionTarget = null
                    toggleReaction(message, emoji)
                }, modifier = Modifier.weight(1f), contentPadding = PaddingValues(0.dp)) { MobileText(emoji, fontSize = 23.sp) } }
            }
            TextButton(onClick = { replyTo = message; editTarget = null; actionTarget = null }) { MobileText("Ответить") }
            if (message.senderId == user.id && message.kind == "text" && message.gif == null) TextButton(onClick = { editTarget = message; replyTo = null; input = message.body; actionTarget = null }) { MobileText("Изменить") }
            if (message.gif != null) TextButton(enabled = preview == null, onClick = {
                actionTarget = null
                scope.launch { runCatching { api.favoriteGif(message.id) }.onFailure { error = it.message.orEmpty() } }
            }) { MobileText("Добавить GIF в избранное") }
            TextButton(onClick = { clipboard.setPrimaryClip(android.content.ClipData.newPlainText("TRLKA", message.body)); actionTarget = null }) { MobileText("Копировать текст") }
            TextButton(onClick = { forwardTargets = listOf(message); actionTarget = null }) { MobileText("Переслать") }
            TextButton(onClick = { selected = setOf(message.id); actionTarget = null }) { MobileText("Выделить") }
            if (message.senderId == user.id) {
                TextButton(enabled = preview == null, onClick = { actionTarget = null; scope.launch {
                    runCatching { api.readers(chat.id, message.id) }.onSuccess { readers = it }.onFailure { error = it.message.orEmpty() }
                } }) { MobileText(if (chat.type == "group") "Просмотры" else "Просмотрено") }
                TextButton(enabled = preview == null, onClick = { actionTarget = null; scope.launch {
                    runCatching { api.deleteMessage(message.id) }.onSuccess { messages = messages.filterNot { it.id == message.id } }.onFailure { error = it.message.orEmpty() }
                } }) { MobileText("Удалить", color = MobileDesign.red) }
            }
        }
    } }
    if (chooseGif) ModalBottomSheet(onDismissRequest = { chooseGif = false }, containerColor = MobileDesign.canvas) {
        LaunchedEffect(favoriteAttempt) {
            gifError = false
            try { favorites = api.gifFavorites() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { gifError = true }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                MobileText("Избранные GIF", Modifier.weight(1f), fontSize = 19.sp, fontWeight = FontWeight.Bold)
                TextButton(onClick = { gifUpload.launch(arrayOf("image/gif")) }) { MobileText("Свой GIF") }
            }
            if (gifError) TextButton(onClick = { favoriteAttempt++ }) { MobileText("Повторить") }
            else if (favorites == null) CircularProgressIndicator(Modifier.size(24.dp))
            else if (favorites!!.isEmpty()) MobileText("Здесь появятся ваши GIF", color = MobileDesign.muted)
            LazyColumn(Modifier.heightIn(max = 360.dp)) {
                items(favorites.orEmpty().chunked(3)) { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { gif -> NativeGifImage(gif, api, cache, user.id, false,
                        modifier = Modifier.weight(1f).padding(vertical = 3.dp).aspectRatio(1.5f).clip(RoundedCornerShape(8.dp)).clickable { sendGif { gif } }) }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                } }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
    if (forwardTargets.isNotEmpty()) ModalBottomSheet(onDismissRequest = { if (!forwarding) { forwardTargets = emptyList(); forwardDestination = null } }, containerColor = MobileDesign.canvas) {
        var forwardError by remember { mutableStateOf("") }
        var loadAttempt by remember { mutableIntStateOf(0) }
        LaunchedEffect(loadAttempt) {
            if (preview == null) try { forwardingChats = api.loadChats(); forwardError = "" }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { forwardError = e.message.orEmpty() }
        }
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            MobileText("Переслать сообщение", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            if (forwardError.isNotEmpty()) MobileText(forwardError, localize = false, color = MobileDesign.red)
            val sendTo: (ChatSummary?) -> Unit = { destination -> if (!forwarding) {
                forwardError = ""
                forwarding = true
                scope.launch {
                    try {
                        val target = forwardDestination ?: destination ?: api.savedChat()
                        forwardDestination = target
                        for (message in forwardTargets.toList()) {
                            api.forward(message.id, target.id)
                            forwardTargets = forwardTargets.filterNot { it.id == message.id }
                            selected = selected - message.id
                            if (forwardTargets.isNotEmpty()) delay(600)
                        }
                        forwardDestination = null; onChanged()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { forwardError = e.message.orEmpty() }
                    finally { forwarding = false }
                }
            } }
            if (forwardDestination != null) {
                MobileText(forwardDestination!!.displayTitle(user.id), localize = false)
                if (forwarding) CircularProgressIndicator(Modifier.size(20.dp))
                else TextButton(onClick = { sendTo(forwardDestination) }) { MobileText("Повторить") }
            } else {
                TextButton(enabled = !forwarding && preview == null, onClick = { sendTo(null) }) {
                    Icon(Icons.Outlined.Bookmark, null)
                    MobileText("Избранное", Modifier.padding(start = 8.dp))
                }
                if (forwardError.isNotEmpty()) TextButton(onClick = { loadAttempt++ }) { MobileText("Повторить") }
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(forwardingChats.filterNot { it.isSaved }.sortedByDescending { it.lastMessageAt }, key = { it.id }) { destination ->
                        TextButton(enabled = !forwarding, onClick = { sendTo(destination) }, modifier = Modifier.fillMaxWidth()) {
                            MobileAvatar(destination.displayTitle(user.id), destination.avatarUrl)
                            MobileText(destination.displayTitle(user.id), localize = false, modifier = Modifier.padding(start = 12.dp))
                        }
                    }
                }
            }
        }
    }
    readers?.let { entries -> ModalBottomSheet(onDismissRequest = { readers = null }, containerColor = MobileDesign.canvas) {
        Column(Modifier.padding(16.dp)) {
            MobileText(if (entries.isEmpty()) "Ещё не просмотрено" else "Просмотрено", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            if (chat.type == "group") LazyColumn(Modifier.heightIn(max = 260.dp)) { items(entries) { reader ->
                Row(Modifier.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    MobileAvatar(reader.name, reader.avatar, 30.dp)
                    Column(Modifier.padding(start = 10.dp)) { MobileText(reader.name, localize = false); MobileText(mobileMessageTime(reader.at), color = MobileDesign.muted, fontSize = 11.sp) }
                }
            } }
            Spacer(Modifier.height(20.dp))
        }
    } }
    if (showProfile) {
        LaunchedEffect(chat.id) {
            val peer = chat.members.firstOrNull { it.id != user.id }
            if (preview == null && peer != null && chat.type != "group") runCatching { api.profile(peer.id) }.onSuccess { peerProfile = it }
        }
        ModalBottomSheet(onDismissRequest = { showProfile = false }, containerColor = MobileDesign.canvas) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (chat.type == "group") {
                    MobileText("Участники — ${chat.members.size}", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    chat.members.forEach { member -> Row(verticalAlignment = Alignment.CenterVertically) { MobileAvatar(member.displayName, member.avatarUrl); MobileText(member.displayName, localize = false, modifier = Modifier.padding(start = 12.dp)) } }
                } else {
                    val peer = chat.members.firstOrNull { it.id != user.id }
                    ProfileIdentity(peerProfile ?: SignedInUser(peer?.id.orEmpty(), peer?.username.orEmpty(), peer?.displayName ?: "Профиль", avatarUrl = peer?.avatarUrl))
                }
                Spacer(Modifier.height(24.dp))
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
    Box(modifier.background(Color(0xFF101E2E)).clickable(enabled = bytes != null && !failed && !full, onClick = onClick), contentAlignment = Alignment.Center) {
        if (bytes != null) AsyncImage(
            model = ImageRequest.Builder(LocalContext.current).data(bytes).memoryCachePolicy(CachePolicy.DISABLED).diskCachePolicy(CachePolicy.DISABLED).build(),
            contentDescription = "Фотография", contentScale = if (full) ContentScale.Fit else ContentScale.Crop, modifier = Modifier.matchParentSize(),
            onSuccess = { decoding = false }, onError = { failed = true },
        )
        if (failed) TextButton(onClick = { bytes = null; attempt++ }) { MobileText("Фото не загрузилось · Повторить") }
        else if (bytes == null || decoding) CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.dp)
    }
}

@Composable
private fun ChatAvatar(url: String?, name: String) {
    Box(Modifier.size(30.dp).clip(CircleShape).background(Color(0xFF153547)), contentAlignment = Alignment.Center) {
        if (url != null) AsyncImage(url, name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else MobileText(name.take(1).uppercase(), fontSize = 12.sp, color = Color(0xFF77E5E8))
    }
}

private fun chatDate(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("dd.MM · HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrDefault("")
