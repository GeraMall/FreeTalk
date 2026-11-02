package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun ServiceBotScreen(api: FreeTalkApi, onBack: () -> Unit, preview: List<ServiceEntry>? = null) {
    var messages by remember { mutableStateOf(preview.orEmpty()) }
    var input by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(preview == null) }
    var profile by remember { mutableStateOf(false) }
    var request by remember { mutableStateOf<Pair<String, String>?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        try { if (preview == null) messages = api.serviceMessages(query); error = "" }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: "Не удалось загрузить сообщения" }
        finally { loading = false }
    }
    LaunchedEffect(query) { delay(200); refresh() }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(MobileDesign.canvas).safeDrawingPadding().imePadding()) {
        Column(Modifier.background(MobileDesign.header)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Назад к чатам") }
                MobileAvatar("TRLKA", null, bot = true)
                Column(Modifier.weight(1f).clickable { profile = true }.padding(horizontal = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("TRLKA", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text("БОТ", fontSize = 9.sp, color = MobileDesign.accent, modifier = Modifier.background(MobileDesign.outgoing, RoundedCornerShape(4.dp)).padding(4.dp))
                    }
                    Text("Уведомления и поддержка", fontSize = 11.sp, color = MobileDesign.muted)
                }
                IconButton(onClick = { profile = true }) { Icon(Icons.Outlined.AccountBox, "Профиль бота") }
            }
            MobileSearch(query, { query = it.take(200) }, "Искать в «TRLKA»", Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 10.dp))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), reverseLayout = true, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (error.isNotEmpty()) item { Text(error, color = MobileDesign.red, fontSize = 12.sp) }
            items(messages.filter { preview == null || it.body.contains(query, true) }.asReversed(), key = { it.id }) { entry ->
                val own = entry.author == "user"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (own) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
                    if (!own) { MobileAvatar("TRLKA", null, 28.dp, bot = true); Spacer(Modifier.width(8.dp)) }
                    MobileMessage(entry.body, mobileMessageTime(entry.createdAt), own, Modifier.widthIn(max = 640.dp).weight(1f, fill = false))
                }
            }
            if (loading) item { CircularProgressIndicator(Modifier.size(24.dp)) }
            item {
                Column(Modifier.padding(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.Forum, null, Modifier.size(36.dp), tint = MobileDesign.accent)
                    Text("На связи — TRLKA", fontSize = 23.sp, fontWeight = FontWeight.Bold)
                    Text("Здесь уведомления о звонках, сообщения об ошибках и ваши предложения.", fontSize = 13.sp, color = MobileDesign.muted)
                }
            }
        }
        FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(Triple("/bug", "Сообщить об ошибке", Icons.Outlined.BugReport), Triple("/idea", "Предложить улучшение", Icons.Outlined.Lightbulb), Triple("/subscription", "Подписка", Icons.Outlined.AutoAwesome)).forEach { (command, label, icon) ->
                OutlinedButton(onClick = { input = command }, shape = RoundedCornerShape(9.dp), border = BorderStroke(1.dp, MobileDesign.stroke), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
                    Icon(icon, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(label, fontSize = 11.sp)
                }
            }
        }
        MobileComposer(input, { input = it }, busy, enabled = preview == null, placeholder = "Сообщение или /help") {
            val body = input.trim()
            if (body.isNotEmpty() && !busy) {
                val id = request?.takeIf { it.first == body }?.second ?: UUID.randomUUID().toString()
                request = body to id; busy = true
                scope.launch {
                    try { api.sendServiceMessage(body, id); request = null; if (input.trim() == body) input = ""; refresh() }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message ?: "Не отправлено. Повторите попытку." }
                    finally { busy = false }
                }
            }
        }
    }
    if (profile) ModalBottomSheet(onDismissRequest = { profile = false }, containerColor = MobileDesign.canvas) {
        Column(Modifier.padding(20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            MobileAvatar("TRLKA", null, 72.dp, bot = true)
            Text("TRLKA · БОТ", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("Уведомления и поддержка", color = MobileDesign.accent)
            HorizontalDivider(color = MobileDesign.stroke)
            Text("Официальный служебный бот TRLKA. Здесь можно сообщить об ошибке или предложить улучшение. Предложение — раз в 24 часа.", fontSize = 14.sp)
            Text("/bug · /idea · /subscription · /cancel", color = MobileDesign.muted, fontSize = 13.sp)
        }
    }
}

internal fun mobileMessageTime(value: String): String = runCatching {
    java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("")
