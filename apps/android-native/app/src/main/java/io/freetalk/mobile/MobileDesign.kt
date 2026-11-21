package io.freetalk.mobile

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectable
import coil.compose.AsyncImage

// Mobile web palette and geometry, shared by the Android screens.
internal object MobileDesign {
    private val light get() = MobilePreferences.theme == "light"
    private val black get() = MobilePreferences.theme == "black"
    val background get() = Color(if (light) 0xFFF4F7FC else if (black) 0xFF000000 else 0xFF040B14)
    val canvas get() = Color(if (light) 0xFFF8FAFE else if (black) 0xFF070707 else 0xFF07111D)
    val header get() = Color(if (light) 0xFFFFFFFF else if (black) 0xFF101010 else 0xFF0A1623)
    val incoming get() = Color(if (light) 0xFFFFFFFF else if (black) 0xFF141414 else 0xFF101E2E)
    val outgoing get() = Color(if (light) 0xFFDCE7FC else if (black) 0xFF242424 else 0xFF1A2C48)
    val input get() = Color(if (light) 0xFFFFFFFF else if (black) 0xFF050505 else 0xFF050D18)
    val stroke get() = Color(if (light) 0xFFB6C6DE else if (black) 0xFF333333 else 0xFF29384E)
    val accent get() = Color(if (light) 0xFF365C9A else 0xFF8DA6DC)
    val muted get() = Color(if (light) 0xFF596C86 else 0xFF9AABC1)
    val text get() = Color(if (light) 0xFF182A43 else 0xFFF4F8FF)
    val green = Color(0xFF55DFAD)
    val red = Color(0xFFEF7290)
    val gradient get() = Brush.horizontalGradient(listOf(Color(0xFF8DA6DC), Color(0xFF95ADE2), Color(0xFF4B7FFF)))
}

internal object MobilePreferences {
    var textScale by mutableStateOf(1f)
    var mirrorSelf by mutableStateOf(true)
    var showQrShortcut by mutableStateOf(true)
    var shareQuality by mutableStateOf(ScreenShareQuality())
    var language by mutableStateOf("ru")
    var theme by mutableStateOf("default")
    fun load(context: Context) {
        val prefs = context.getSharedPreferences("mobile-design", Context.MODE_PRIVATE)
        textScale = prefs.getFloat("textScale", 1f).coerceIn(.85f, 1.55f)
        mirrorSelf = prefs.getBoolean("mirrorSelf", true)
        showQrShortcut = prefs.getBoolean("showQrShortcut", true)
        shareQuality = ScreenShareQuality(
            prefs.getInt("shareResolution", 1080).takeIf { it in listOf(720, 1080, 1440) } ?: 1080,
            prefs.getInt("shareFps", 30).takeIf { it in listOf(15, 30, 60) } ?: 30,
            ShareContent.entries.find { it.name == prefs.getString("shareContent", "") } ?: ShareContent.Balanced,
        )
        language = prefs.getString("language", "ru").orEmpty().takeIf { it in listOf("ru", "en", "zh-CN", "kk", "be", "ka", "es") } ?: "ru"
        theme = prefs.getString("theme", "default").orEmpty().takeIf { it in listOf("default", "light", "black") } ?: "default"
    }
    fun save(context: Context) {
        context.getSharedPreferences("mobile-design", Context.MODE_PRIVATE).edit()
            .putFloat("textScale", textScale).putBoolean("mirrorSelf", mirrorSelf).putBoolean("showQrShortcut", showQrShortcut)
            .putInt("shareResolution", shareQuality.shortEdge).putInt("shareFps", shareQuality.fps).putString("shareContent", shareQuality.content.name)
            .putString("language", language).putString("theme", theme).apply()
    }
}

@Composable
internal fun MobileAvatar(name: String, url: String?, size: Dp = 40.dp, bot: Boolean = false) {
    Box(Modifier.size(size).clip(CircleShape)
        .background(if (bot) Color.Black else Color(0xFF2C416D))
        .border(1.dp, MobileDesign.accent.copy(alpha = .25f), CircleShape),
        contentAlignment = Alignment.Center) {
        when {
            bot -> Image(painterResource(R.drawable.freetalk_mascot), name, Modifier.fillMaxSize())
            url != null -> AsyncImage(url, name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else -> MobileText(name.take(1).uppercase(), fontWeight = FontWeight.Bold, fontSize = (size.value * .38f).sp, color = Color.White)
        }
    }
}

@Composable
internal fun MobileSearch(value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    Row(modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).background(MobileDesign.input)
        .border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        WebIcon(WebIcons.Search, null, Modifier.size(18.dp), tint = MobileDesign.muted)
        BasicTextField(value, onValue, modifier = Modifier.weight(1f), singleLine = true,
            textStyle = TextStyle(color = MobileDesign.text, fontSize = 16.sp), cursorBrush = SolidColorBrush(),
            decorationBox = { inner -> Box { if (value.isEmpty()) MobileText(placeholder, color = MobileDesign.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } })
    }
}

private fun SolidColorBrush() = androidx.compose.ui.graphics.SolidColor(MobileDesign.accent)

@Composable
internal fun MobileComposer(text: String, onText: (String) -> Unit, sending: Boolean, enabled: Boolean = true,
    placeholder: String = "Сообщение", onAttach: (() -> Unit)? = null, onGif: (() -> Unit)? = null,
    onSticker: (() -> Unit)? = null, onSend: () -> Unit) {
    var emojiOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(MobileDesign.canvas)) {
        if (emojiOpen) {
            Column(Modifier.fillMaxWidth().padding(10.dp).border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp)).padding(8.dp)) {
                listOf("😀", "😎", "😂", "🥰", "🤔", "😢", "🔥", "❤️", "👍", "🎉", "👋", "🙏", "💯", "✨", "😴", "🤝").chunked(8).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        row.forEach { emoji -> WebTextButton(onClick = { onText(text + emoji); emojiOpen = false }, contentPadding = PaddingValues(4.dp)) { MobileText(emoji, fontSize = 22.sp) } }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            if (onAttach != null) WebIconButton(onClick = onAttach, enabled = enabled && !sending,
                modifier = Modifier.size(38.dp, 44.dp).border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp))) {
                WebIcon(WebIcons.ImagePlus, "Добавить файл или фотографию", Modifier.size(18.dp))
            }
            Row(Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp))
                .background(MobileDesign.input).border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp)), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(text, { NativeSettingsStore.markTyping(); onText(it.take(4000)) }, modifier = Modifier.weight(1f).heightIn(min = 44.dp, max = 120.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                    textStyle = LocalTextStyle.current.copy(color = MobileDesign.text, fontSize = 16.sp, lineHeight = 22.sp),
                    maxLines = 4, cursorBrush = SolidColorBrush(), enabled = !sending,
                    decorationBox = { inner -> Box { if (text.isEmpty()) MobileText(placeholder, color = MobileDesign.muted, fontSize = 16.sp, lineHeight = 22.sp); inner() } })
                if (onGif != null) WebTextButton(onClick = onGif, enabled = enabled && !sending,
                    modifier = Modifier.width(26.dp), contentPadding = PaddingValues(0.dp)) { MobileText("GIF", color = MobileDesign.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
                if (onSticker != null) WebIconButton(onClick = onSticker, enabled = enabled && !sending, modifier = Modifier.size(26.dp, 32.dp)) { WebIcon(WebIcons.Sticker, "Стикеры", Modifier.size(17.dp)) }
                WebIconButton(onClick = { emojiOpen = !emojiOpen }, enabled = enabled && !sending, modifier = Modifier.size(26.dp, 32.dp).padding(end = 2.dp)) { WebIcon(WebIcons.Smile, "Эмодзи", Modifier.size(17.dp)) }
            }
            WebIconButton(onClick = onSend, enabled = enabled && !sending && text.isNotBlank(),
                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(MobileDesign.gradient)) {
                if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MobileDesign.input)
                else WebIcon(WebIcons.Send, "Отправить", Modifier.size(19.dp), tint = Color(0xFF01050D))
            }
        }
    }
}

@Composable
internal fun MobileMessage(text: String, date: String, own: Boolean, modifier: Modifier = Modifier, onLink: ((String) -> Boolean)? = null, compact: Boolean = false, afterText: (@Composable () -> Unit)? = null, content: (@Composable () -> Unit)? = null) {
    val shape = RoundedCornerShape(topStart = if (own) 14.dp else 0.dp, topEnd = if (own) 0.dp else 14.dp, bottomStart = 14.dp, bottomEnd = 14.dp)
    Surface(modifier, color = if (compact) Color.Transparent else if (own) MobileDesign.outgoing else MobileDesign.incoming, shape = shape,
        border = if (compact) null else BorderStroke(1.dp, if (own) Color(0xFF3D5073) else MobileDesign.stroke)) {
        Column(Modifier.padding(horizontal = if (compact) 0.dp else 11.dp, vertical = if (compact) 2.dp else 7.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            content?.invoke()
            if (text.isNotBlank()) LinkedMessageText(text, onLink, date)
            afterText?.invoke()
            if (text.isBlank() && date.isNotBlank()) MobileText(date, fontSize = 10.sp, color = MobileDesign.muted)
        }
    }
}

@Composable
private fun MobileNavItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, selected: Boolean,
    modifier: Modifier = Modifier, onClick: () -> Unit) {
    val color = if (selected) MobileDesign.accent else MobileDesign.muted
    Column(modifier.height(52.dp).clip(RoundedCornerShape(12.dp))
        .background(if (selected) MobileDesign.accent.copy(alpha = .08f) else Color.Transparent)
        .selectable(selected, role = Role.Tab, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        WebIcon(icon, null, Modifier.size(21.dp), tint = color)
        MobileText(label, fontSize = 10.sp, color = color, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private data class MobileDestination(
    val index: Int,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private val mobileDestinations by lazy {
    listOf(
        MobileDestination(0, "Главная", WebIcons.Home),
        MobileDestination(1, "Чаты", WebIcons.ChatBubbleOutline),
        MobileDestination(2, "Друзья", WebIcons.PeopleOutline),
        MobileDestination(4, "Магазин", WebIcons.Lock),
        MobileDestination(3, "История", WebIcons.History),
    )
}

@Composable
private fun ComputerLoginShortcut(modifier: Modifier = Modifier, onScan: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    WebIconButton(onClick = onScan, modifier = modifier.size(48.dp)
        .clip(shape).background(MobileDesign.accent.copy(alpha = .12f)).border(1.dp, MobileDesign.stroke, shape)) {
        WebIcon(WebIcons.QrCodeScanner, "Сканировать QR для входа", Modifier.size(23.dp), tint = MobileDesign.accent)
    }
}

@Composable
internal fun MobileBottomNavigation(page: Int, onScan: (() -> Unit)? = null, onPage: (Int) -> Unit) {
    var moreOpen by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().background(MobileDesign.background).navigationBarsPadding().padding(horizontal = 7.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically) {
        val shortcut = onScan.takeIf { MobilePreferences.showQrShortcut }
        if (shortcut == null) {
            mobileDestinations.forEach { tab ->
                MobileNavItem(tab.icon, tab.label, page == tab.index, Modifier.weight(1f)) { onPage(tab.index) }
            }
        } else {
            mobileDestinations.take(2).forEach { tab ->
                MobileNavItem(tab.icon, tab.label, page == tab.index, Modifier.weight(1f)) { onPage(tab.index) }
            }
            ComputerLoginShortcut(onScan = shortcut)
            val friends = mobileDestinations[2]
            MobileNavItem(friends.icon, friends.label, page == friends.index, Modifier.weight(1f)) { onPage(friends.index) }
            Box(Modifier.weight(1f)) {
                MobileNavItem(WebIcons.MoreHoriz, "Ещё", page in setOf(3, 4), Modifier.fillMaxWidth()) { moreOpen = true }
                DropdownMenu(expanded = moreOpen, onDismissRequest = { moreOpen = false }) {
                    mobileDestinations.drop(3).forEach { tab ->
                        DropdownMenuItem(text = { MobileText(tab.label) }, leadingIcon = { WebIcon(tab.icon, null, Modifier.size(18.dp)) },
                            onClick = { moreOpen = false; onPage(tab.index) })
                    }
                }
            }
        }
    }
}

@Composable
internal fun AdaptiveMobileScaffold(page: Int, onScan: (() -> Unit)? = null, onPage: (Int) -> Unit,
    content: @Composable () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(MobileDesign.background)) {
        val showRail = maxWidth >= 720.dp
        Scaffold(containerColor = Color.Transparent,
            bottomBar = { if (!showRail) MobileBottomNavigation(page, onScan, onPage) }) { padding ->
            Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
                if (showRail) {
                    Column(Modifier.fillMaxHeight().width(92.dp).background(MobileDesign.background)
                        .padding(horizontal = 10.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        mobileDestinations.forEach { tab ->
                            MobileNavItem(tab.icon, tab.label, page == tab.index, Modifier.fillMaxWidth()) { onPage(tab.index) }
                        }
                        if (onScan != null && MobilePreferences.showQrShortcut) {
                            Spacer(Modifier.weight(1f))
                            ComputerLoginShortcut(onScan = onScan)
                        }
                    }
                    Box(Modifier.fillMaxHeight().width(1.dp).background(MobileDesign.stroke))
                }
                Box(Modifier.weight(1f).fillMaxHeight()) { content() }
            }
        }
    }
}
