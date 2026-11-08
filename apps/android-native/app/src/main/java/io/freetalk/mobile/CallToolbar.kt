package io.freetalk.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.*
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
fun CallToolbar(muted: Boolean, camera: Boolean, sharing: Boolean, mediaReady: Boolean,
    onMic: () -> Unit, onAudio: () -> Unit, onCamera: () -> Unit, onCameraOptions: () -> Unit,
    onScreen: () -> Unit, onReaction: () -> Unit, onChat: () -> Unit, onMore: () -> Unit, onLeave: () -> Unit,
    onActivity: (() -> Unit)? = null) {
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
        Row(Modifier.widthIn(max = if (onActivity != null) 370.dp else 310.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CallSquare(if (muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, "Микрофон", if (muted) MobileDesign.red else MobileDesign.green, Modifier.weight(1f), active = !muted, onClick = onMic)
            CallSquare(if (camera) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, "Камера", if (camera) MobileDesign.accent else MobileDesign.red, Modifier.weight(1f), active = camera, enabled = mediaReady, onClick = onCamera)
            if (onActivity != null) CallSquare(Icons.Outlined.Category, "Игры", MobileDesign.accent, Modifier.weight(1f), onClick = onActivity)
            CallSquare(Icons.Outlined.MoreHoriz, "Ещё", MobileDesign.text, Modifier.weight(1f), onClick = onMore)
            CallSquare(Icons.AutoMirrored.Outlined.ExitToApp, "Выйти", Color.White, Modifier.weight(1f), destructive = true, onClick = onLeave)
        }
    }
}

@Composable
private fun CallSquare(icon: ImageVector, title: String, tint: Color, modifier: Modifier, active: Boolean = false,
    enabled: Boolean = true, destructive: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(modifier.height(54.dp).clip(shape)
        .background(if (destructive) Color(0xFFE8315C) else tint.copy(alpha = if (active) .16f else .10f))
        .border(1.dp, tint.copy(alpha = if (active) .38f else .15f), shape)
        .clickable(enabled = enabled, role = Role.Button, onClickLabel = title, onClick = onClick),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, title, Modifier.size(20.dp), tint = tint.copy(alpha = if (enabled) 1f else .4f))
        MobileText(title, color = tint, fontSize = 10.sp, maxLines = 1, modifier = Modifier.padding(top = 5.dp))
    }
}
