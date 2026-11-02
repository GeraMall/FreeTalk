package io.freetalk.mobile

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTransformGestures
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun CallParticipants(peers: List<RoomPeer>, selfId: String, media: NativeCallMedia?, videoMode: Boolean,
    focused: String?, onFocus: (String?) -> Unit, modifier: Modifier = Modifier) {
    val selected = peers.firstOrNull { it.id == focused }
    if (!videoMode) {
        LazyColumn(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(peers, key = { it.id }) { peer ->
                Surface(color = MobileDesign.incoming.copy(alpha = .7f), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        MobileAvatar(peer.name, peer.avatar, 46.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(peer.name + if (peer.id == selfId) " · вы" else "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(if (peer.id == selfId) "Вы в звонке" else media?.connections?.get(peer.id) ?: "Подключение…", color = MobileDesign.muted, fontSize = 12.sp)
                        }
                        if (peer.owner) Icon(Icons.Outlined.WorkspacePremium, "Создатель комнаты", Modifier.size(16.dp), tint = Color(0xFFE6C46A))
                        if (peer.muted) Icon(Icons.Outlined.MicOff, "Микрофон выключен", Modifier.size(18.dp), tint = MobileDesign.red)
                        else VoiceLevelIndicator(media?.levels?.get(peer.id) ?: 0f, media?.speaking?.contains(peer.id) == true)
                    }
                }
            }
        }
        return
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val width = maxWidth; val height = maxHeight
        if (selected != null) {
            ParticipantTile(selected, selfId, media, Modifier.fillMaxSize())
            IconButton(onClick = { onFocus(null) }, modifier = Modifier.align(Alignment.TopStart).padding(10.dp).background(MobileDesign.background.copy(alpha = .8f), RoundedCornerShape(12.dp))) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Вернуться к участникам")
            }
            val self = peers.firstOrNull { it.id == selfId }
            val mini = if (selected.id != selfId) self else peers.firstOrNull { it.id != selfId }
            if (media?.camera == true && mini != null) {
                var scale by remember { mutableFloatStateOf(1f) }
                var x by remember { mutableFloatStateOf(0f) }; var y by remember { mutableFloatStateOf(0f) }
                val miniWidth = (width * .3f * scale).coerceIn(90.dp, width * .62f)
                val miniHeight = miniWidth * 1.35f
                Box(Modifier.align(Alignment.TopEnd).offset(x = x.dp, y = y.dp).padding(10.dp)
                    .size(miniWidth, miniHeight).pointerInput(width, height) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(.8f, 2f)
                            val liveWidth = (width * .3f * scale).coerceIn(90.dp, width * .62f)
                            x = (x + pan.x / density).coerceIn(-(width - liveWidth).value.coerceAtLeast(0f), 0f)
                            y = (y + pan.y / density).coerceIn(0f, (height - liveWidth * 1.35f).value.coerceAtLeast(0f))
                        }
                    }.clickable(onClickLabel = "Поменять видео местами") { onFocus(mini.id) }) {
                    ParticipantTile(mini, selfId, media, Modifier.fillMaxSize(), compact = true)
                }
            }
        } else {
            val layout = CallTileLayout.calculate(width.value, height.value, peers.size)
            Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState(), enabled = layout.canvasHeight > height.value + 1)) {
                Box(Modifier.fillMaxWidth().height(layout.canvasHeight.dp)) {
                    peers.forEachIndexed { index, peer ->
                        key(peer.id) {
                            val frame = layout.frames[index]
                            val x by animateDpAsState(frame.x.dp, label = "tile x")
                            val y by animateDpAsState(frame.y.dp, label = "tile y")
                            val w by animateDpAsState(frame.width.dp, label = "tile width")
                            val h by animateDpAsState(frame.height.dp, label = "tile height")
                            ParticipantTile(peer, selfId, media, Modifier.offset(x, y).size(w, h).clickable(onClickLabel = "Раскрыть ${peer.name}") { onFocus(peer.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ParticipantTile(peer: RoomPeer, selfId: String, media: NativeCallMedia?, modifier: Modifier, compact: Boolean = false) {
    val self = peer.id == selfId
    val track = media?.videos?.get(if (self) "self:screen" else "${peer.id}:screen")
        ?: media?.videos?.get(if (self) "self:camera" else "${peer.id}:camera")
    val screen = media?.videos?.containsKey(if (self) "self:screen" else "${peer.id}:screen") == true
    Box(modifier.clip(RoundedCornerShape(20.dp)).background(MobileDesign.incoming).border(1.dp, MobileDesign.stroke, RoundedCornerShape(20.dp)), contentAlignment = Alignment.Center) {
        if (track != null && media != null) RoomVideo(track, media, self && !screen && MobilePreferences.mirrorSelf, Modifier.fillMaxSize())
        else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MobileAvatar(peer.name, peer.avatar, if (compact) 32.dp else 64.dp)
            Text(peer.name, fontSize = if (compact) 10.sp else 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
        if (track != null) Text(peer.name + if (self) " · вы" else "", fontSize = if (compact) 10.sp else 12.sp,
            modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = .5f)).padding(10.dp))
    }
}
