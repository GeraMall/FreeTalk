package io.freetalk.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun CallHeader(title: String, status: String, time: String, onMinimize: () -> Unit, onChat: () -> Unit,
    compact: Boolean = false) {
    Row(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
        .padding(horizontal = 10.dp, vertical = if (compact) 2.dp else 8.dp), verticalAlignment = Alignment.CenterVertically) {
        WebIconButton(onClick = onMinimize) { WebIcon(WebIcons.ArrowBack, "Свернуть звонок") }
        Column(Modifier.weight(1f).padding(horizontal = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            MobileText(title, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, fontSize = 14.sp,
                maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            MobileText(status, color = MobileDesign.muted, fontSize = 10.sp, maxLines = 1)
        }
        if (time.isNotBlank()) MobileText(time, color = MobileDesign.muted, fontSize = 10.sp)
        WebOutlinedButton(onClick = onChat, modifier = Modifier.padding(start = 8.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 7.dp)) {
            WebIcon(WebIcons.ChatBubbleOutline, null, Modifier.size(17.dp))
            MobileText("Чат", Modifier.padding(start = 6.dp), fontSize = 13.sp)
        }
    }
}

@Composable
fun CallToolbar(muted: Boolean, camera: Boolean, sharing: Boolean, mediaReady: Boolean,
    onMic: () -> Unit, onAudio: () -> Unit, onCamera: () -> Unit, onCameraOptions: () -> Unit,
    onScreen: () -> Unit, onReaction: () -> Unit, onChat: () -> Unit, onMore: () -> Unit, onLeave: () -> Unit,
    onActivity: (() -> Unit)? = null, cameraStarting: Boolean = false, compact: Boolean = false) {
    val height = if (compact) 48.dp else 54.dp
    Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
        .padding(horizontal = 10.dp, vertical = if (compact) 4.dp else 12.dp), contentAlignment = Alignment.Center) {
        Row(Modifier.widthIn(max = if (onActivity != null) 294.dp else 234.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val control = Modifier.weight(1f).height(height)
            CallSquare(if (muted) WebIcons.MicOff else WebIcons.Mic, "Микрофон", if (muted) MobileDesign.red else MobileDesign.green,
                control, active = !muted, onClick = onMic)
            CallSquare(if (camera) WebIcons.Videocam else WebIcons.VideocamOff, "Камера", if (camera || cameraStarting) MobileDesign.accent else MobileDesign.red,
                control, active = camera, enabled = mediaReady, pending = cameraStarting, onClick = onCamera)
            if (onActivity != null) CallSquare(WebIcons.Category, "Игры", MobileDesign.accent, control, onClick = onActivity)
            CallSquare(WebIcons.MoreHoriz, "Ещё", MobileDesign.text, control, onClick = onMore)
            CallSquare(WebIcons.ExitToApp, "Выйти", Color.White, control, destructive = true, onClick = onLeave)
        }
    }
}

@Composable
private fun CallSquare(icon: ImageVector, title: String, tint: Color, modifier: Modifier, active: Boolean = false,
    enabled: Boolean = true, destructive: Boolean = false, pending: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier.clip(shape)
        .background(if (destructive) Color(0xFFE8315C) else tint.copy(alpha = if (active) .16f else .10f))
        .border(1.dp, tint.copy(alpha = if (active) .38f else .15f), shape)
        .clickable(enabled = enabled, role = Role.Button, onClickLabel = title, onClick = onClick),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        if (pending) CircularProgressIndicator(Modifier.size(18.dp), color = tint, strokeWidth = 2.dp)
        else WebIcon(icon, title, Modifier.size(20.dp), tint = tint.copy(alpha = if (enabled) 1f else .4f))
        MobileText(title, color = tint, fontSize = 8.sp, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
    }
}
