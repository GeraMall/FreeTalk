package io.freetalk.mobile

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex

@Composable
internal fun CallParticipants(peers: List<RoomPeer>, selfId: String, media: NativeCallMedia?, videoMode: Boolean,
    focused: String?, onFocus: (String?) -> Unit, modifier: Modifier = Modifier) {
    val selected = peers.firstOrNull { videoMode && it.id == focused }
    val others = peers.filter { it.id != selected?.id }
    val mini = if (selected == null) null else
        others.firstOrNull { it.id == selfId && media?.camera == true }
            ?: others.firstOrNull { peer -> media?.videos?.keys?.any { it.startsWith("${peer.videoPrefix(selfId)}:") } == true }
    var zoom by remember(selected?.id, mini?.id) { mutableFloatStateOf(1f) }
    var dx by remember(selected?.id, mini?.id) { mutableFloatStateOf(0f) }
    var dy by remember(selected?.id, mini?.id) { mutableFloatStateOf(0f) }
    BoxWithConstraints(modifier.fillMaxSize().clip(RoundedCornerShape(18.dp))) {
        val width = maxWidth.value.coerceAtLeast(1f)
        val height = maxHeight.value.coerceAtLeast(1f)
        val grid = remember(width, height, peers.size, videoMode) {
            if (videoMode) CallTileLayout.calculate(width, height, peers.size) else CallTileLayout.audio(width, height, peers.size)
        }
        val scroll = rememberScrollState()
        val canvas = if (selected == null) grid.canvasHeight else height
        val canvasHeight by animateDpAsState(canvas.dp, tween(220), label = "call grid height")
        LaunchedEffect(selected?.id) { if (selected != null && scroll.value != 0) scroll.animateScrollTo(0, tween(220)) }
        Box(Modifier.fillMaxSize().verticalScroll(scroll, enabled = selected == null && grid.canvasHeight > height + 1f)) {
            Box(Modifier.fillMaxWidth().height(canvasHeight)) {
                peers.forEachIndexed { index, peer -> key(peer.id) {
                    val primary = selected?.id == peer.id
                    val preview = mini?.id == peer.id
                    val shown = selected == null || primary || preview
                    val frame = when {
                        primary -> CallTileFrame(0f, 0f, width, height)
                        preview -> CallTileLayout.preview(width, height, zoom, dx, dy)
                        else -> grid.frames[index]
                    }
                    val x by animateDpAsState(frame.x.dp, tween(220), label = "tile x")
                    val y by animateDpAsState(frame.y.dp, tween(220), label = "tile y")
                    val w by animateDpAsState(frame.width.dp, tween(220), label = "tile width")
                    val h by animateDpAsState(frame.height.dp, tween(220), label = "tile height")
                    val opacity by animateFloatAsState(if (shown) 1f else 0f, tween(180), label = "tile opacity")
                    val position = Modifier.zIndex(if (preview) 3f else if (primary) 2f else 1f)
                        .offset(x, y).size(w, h).alpha(opacity)
                    val interaction = when {
                        !shown -> Modifier.clearAndSetSemantics {}
                        preview -> Modifier.pointerInput(width, height, peer.id) {
                            detectTransformGestures { _, pan, scale, _ ->
                                zoom = (zoom * scale).coerceIn(.8f, 2f)
                                val next = CallTileLayout.preview(width, height, zoom, dx + pan.x / density, dy + pan.y / density)
                                val origin = CallTileLayout.preview(width, height, zoom, 0f, 0f)
                                dx = next.x - origin.x
                                dy = next.y - origin.y
                            }
                        }.clickable(onClickLabel = "Поменять видео местами") { onFocus(peer.id) }
                        videoMode && selected == null -> Modifier.clickable(onClickLabel = "Раскрыть ${peer.name}") { onFocus(peer.id) }
                        else -> Modifier
                    }
                    ParticipantTile(peer, selfId, media, position.then(interaction), videoMode, preview, shown, w.value)
                } }
            }
        }
        if (selected != null) {
            WebIconButton(onClick = { onFocus(null) }, modifier = Modifier.align(Alignment.TopStart)
                .padding(10.dp).size(48.dp).background(MobileDesign.background.copy(alpha = .86f), RoundedCornerShape(12.dp))) {
                WebIcon(WebIcons.ArrowBack, "Вернуться к участникам")
            }
        }
    }
}

private fun RoomPeer.videoPrefix(selfId: String) = if (id == selfId) "self" else id

@Composable
private fun ParticipantTile(peer: RoomPeer, selfId: String, media: NativeCallMedia?, modifier: Modifier,
    videoMode: Boolean, compact: Boolean, visible: Boolean, width: Float) {
    val self = peer.id == selfId
    val prefix = peer.videoPrefix(selfId)
    val screen = media?.videos?.get("$prefix:screen")
    val track = screen ?: media?.videos?.get("$prefix:camera")
    val label = peer.name + if (self) " · вы" else ""
    val shape = RoundedCornerShape(18.dp)
    Box(modifier.clip(shape).background(MobileDesign.incoming).border(1.dp, MobileDesign.stroke, shape),
        contentAlignment = Alignment.Center) {
        if (videoMode) {
            Column(Modifier.padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MobileAvatar(peer.name, peer.avatar, if (width < 140 || compact) 32.dp else 56.dp)
                MobileText(label, fontSize = if (compact) 10.sp else 13.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else {
            Row(Modifier.fillMaxSize().padding(12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                MobileAvatar(peer.name, peer.avatar, if (width < 180) 36.dp else 54.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    MobileText(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    MobileText(if (self) "Вы в звонке" else media?.connections?.get(peer.id) ?: "Подключение…",
                        color = MobileDesign.muted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (width >= 155) {
                    if (peer.deafened) WebIcon(WebIcons.HeadsetOff, "Наушники выключены", Modifier.size(16.dp), tint = MobileDesign.red)
                    else if (peer.muted) WebIcon(WebIcons.MicOff, "Микрофон выключен", Modifier.size(16.dp), tint = MobileDesign.red)
                    else if (width >= 230) VoiceLevelIndicator(media?.levels?.get(peer.id) ?: 0f, media?.speaking?.contains(peer.id) == true)
                }
            }
        }
        if (track != null && media != null) {
            key(screen != null) {
                RoomVideo(track, media, self && screen == null && MobilePreferences.mirrorSelf,
                    Modifier.fillMaxSize(), fit = screen != null, visible = visible)
            }
            MobileText(label, fontSize = if (compact) 10.sp else 12.sp, color = Color.White,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = .56f))
                    .padding(horizontal = 9.dp, vertical = if (compact) 5.dp else 8.dp))
        }
    }
}
