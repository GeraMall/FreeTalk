package io.freetalk.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun CallToolbar(muted: Boolean, camera: Boolean, sharing: Boolean, mediaReady: Boolean,
    onMic: () -> Unit, onAudio: () -> Unit, onCamera: () -> Unit, onCameraOptions: () -> Unit,
    onScreen: () -> Unit, onReaction: () -> Unit, onChat: () -> Unit, onMore: () -> Unit, onLeave: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 12.dp)) {
        val compact = maxWidth < 380.dp
        val mainWidth = if (compact) 32.dp else 38.dp
        val arrowWidth = if (compact) 20.dp else 24.dp
        val actionWidth = if (compact) 36.dp else 42.dp
        val green = Color(0xFF72DCC2)
        val pink = Color(0xFFEF7290)
        Row(Modifier.align(Alignment.Center).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(RoundedCornerShape(13.dp)).background(Color(0xFF050C17)).border(1.dp, Color(0xFF1C2B39), RoundedCornerShape(13.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.clip(RoundedCornerShape(8.dp)).background(if (muted) Color(0xFF29121F) else Color(0xFF0D302D))) {
                    ToolbarButton(if (muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (muted) "Включить микрофон" else "Выключить микрофон", mainWidth, if (muted) pink else green, onClick = onMic)
                    ToolbarButton(Icons.Outlined.KeyboardArrowUp, "Настройки звука", arrowWidth, if (muted) pink else green, small = true, onClick = onAudio)
                }
                Row(Modifier.clip(RoundedCornerShape(8.dp)).background(if (camera) Color(0xFF0D302D) else Color(0xFF29121F))) {
                    ToolbarButton(if (camera) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, if (camera) "Выключить камеру" else "Включить камеру", mainWidth, if (camera) green else pink, enabled = mediaReady, onClick = onCamera)
                    ToolbarButton(Icons.Outlined.KeyboardArrowUp, "Настройки камеры", arrowWidth, if (camera) green else pink, small = true, onClick = onCameraOptions)
                }
            }
            Row(Modifier.clip(RoundedCornerShape(13.dp)).background(Color(0xFF050C17)).border(1.dp, Color(0xFF1C2B39), RoundedCornerShape(13.dp)).padding(vertical = 4.dp)) {
                ToolbarButton(Icons.Outlined.ScreenShare, if (sharing) "Остановить показ экрана" else "Показать экран", actionWidth, if (sharing) green else Color(0xFFDDE6F0), enabled = mediaReady, onClick = onScreen)
                ToolbarButton(Icons.Outlined.AddReaction, "Реакции", actionWidth, onClick = onReaction)
                ToolbarButton(Icons.Outlined.ChatBubbleOutline, "Чат комнаты", actionWidth, onClick = onChat)
                ToolbarButton(Icons.Outlined.MoreHoriz, "Ещё", actionWidth, onClick = onMore)
            }
            Box(Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0xFFE83F5F))) {
                ToolbarButton(Icons.AutoMirrored.Outlined.ExitToApp, "Выйти из звонка", 46.dp, Color.White, onClick = onLeave)
            }
        }
    }
}

@Composable
private fun ToolbarButton(icon: ImageVector, label: String, width: Dp, tint: Color = Color(0xFFDDE6F0),
    small: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.width(width).height(48.dp).clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, modifier = Modifier.size(if (small) 15.dp else 21.dp), tint = if (enabled) tint else tint.copy(alpha = 0.4f))
    }
}
