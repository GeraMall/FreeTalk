package io.freetalk.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewChatSheet(friends: List<FriendSummary>, onDismiss: () -> Unit, onDirect: (FriendSummary) -> Unit,
    onGroup: suspend (String, List<FriendSummary>) -> Unit) {
    var group by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val picked = friends.filter { it.id in selected }
    val visible = friends.filter { it.displayName.contains(query.trim(), true) || it.username.contains(query.trim().removePrefix("@"), true) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy || it != SheetValue.Hidden })
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState, containerColor = MobileDesign.canvas) {
        Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MobileText(if (group) "Создать группу" else "Новый чат", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            if (group) {
                OutlinedTextField(title, { title = it.take(80) }, Modifier.fillMaxWidth(), singleLine = true, enabled = !busy, label = { MobileText("Название группы") })
            } else {
                OutlinedButton(onClick = { group = true }) { MobileText("Создать группу") }
            }
            MobileSearch(query, { query = it }, "Поиск друзей", Modifier.fillMaxWidth())
            if (friends.isEmpty()) MobileText("Добавьте друзей, чтобы начать переписку.", color = MobileDesign.muted)
            LazyColumn(Modifier.weight(1f, fill = false)) {
                items(visible, key = { it.id }) { friend ->
                    val checked = friend.id in selected
                    Row(Modifier.fillMaxWidth().clickable(enabled = !busy && (!group || checked || picked.size < 49)) {
                        if (!group) onDirect(friend)
                        else selected = if (checked) selected - friend.id else selected + friend.id
                    }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        MobileAvatar(friend.displayName, friend.avatarUrl)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            MobileText(friend.displayName, localize = false)
                            MobileText("@${friend.username}", localize = false, color = MobileDesign.muted, fontSize = 12.sp)
                        }
                        if (group) Checkbox(checked, onCheckedChange = null)
                    }
                }
            }
            if (error.isNotBlank()) MobileText(error, color = MobileDesign.red)
            if (group) Button(onClick = {
                if (busy) return@Button
                busy = true
                scope.launch {
                    try { onGroup(title.trim(), picked); onDismiss() }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.message ?: "Не удалось создать группу" }
                    finally { busy = false }
                }
            }, enabled = !busy && title.isNotBlank() && picked.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { MobileText("Создать группу") }
            Spacer(Modifier.height(8.dp))
        }
    }
}
