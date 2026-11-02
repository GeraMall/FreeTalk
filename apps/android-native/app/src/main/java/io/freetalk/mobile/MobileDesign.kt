package io.freetalk.mobile

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.PeopleOutline
import androidx.compose.material.icons.outlined.History
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

// Shared with iPhone 0.3.0 build 10; semantic call/presence colors stay distinct.
internal object MobileDesign {
    val background = Color(0xFF040B14)
    val canvas = Color(0xFF07111D)
    val header = Color(0xFF0A1623)
    val incoming = Color(0xFF101E2E)
    val outgoing = Color(0xFF1A2C48)
    val input = Color(0xFF050D18)
    val stroke = Color(0xFF29384E)
    val accent = Color(0xFF8DA6DC)
    val muted = Color(0xFF9AABC1)
    val green = Color(0xFF55DFAD)
    val red = Color(0xFFEF7290)
    val gradient = Brush.horizontalGradient(listOf(accent, Color(0xFF4B7FFF)))
}

internal object MobilePreferences {
    var textScale by mutableStateOf(1f)
    var mirrorSelf by mutableStateOf(true)
    fun load(context: Context) {
        val prefs = context.getSharedPreferences("mobile-design", Context.MODE_PRIVATE)
        textScale = prefs.getFloat("textScale", 1f).coerceIn(.9f, 1.3f)
        mirrorSelf = prefs.getBoolean("mirrorSelf", true)
    }
    fun save(context: Context) {
        context.getSharedPreferences("mobile-design", Context.MODE_PRIVATE).edit()
            .putFloat("textScale", textScale).putBoolean("mirrorSelf", mirrorSelf).apply()
    }
}

@Composable
internal fun MobileAvatar(name: String, url: String?, size: Dp = 40.dp, bot: Boolean = false) {
    Box(Modifier.size(size).clip(if (bot) RoundedCornerShape(10.dp) else CircleShape)
        .background(if (bot) MobileDesign.background else Color(0xFF2C416D))
        .border(1.dp, MobileDesign.accent.copy(alpha = .25f), if (bot) RoundedCornerShape(10.dp) else CircleShape),
        contentAlignment = Alignment.Center) {
        when {
            bot -> Image(painterResource(R.drawable.freetalk_mascot), name, Modifier.fillMaxSize())
            url != null -> AsyncImage(url, name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else -> Text(name.take(1).uppercase(), fontWeight = FontWeight.Bold, fontSize = (size.value * .38f).sp, color = Color.White)
        }
    }
}

@Composable
internal fun MobileSearch(value: String, onValue: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    Row(modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(MobileDesign.input)
        .border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Outlined.Search, null, Modifier.size(18.dp), tint = MobileDesign.muted)
        BasicTextField(value, onValue, modifier = Modifier.weight(1f), singleLine = true,
            textStyle = TextStyle(color = Color.White, fontSize = 16.sp), cursorBrush = SolidColorBrush(),
            decorationBox = { inner -> Box { if (value.isEmpty()) Text(placeholder, color = MobileDesign.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } })
    }
}

private fun SolidColorBrush() = androidx.compose.ui.graphics.SolidColor(MobileDesign.accent)

@Composable
internal fun MobileComposer(text: String, onText: (String) -> Unit, sending: Boolean, enabled: Boolean = true,
    placeholder: String = "Сообщение", onSend: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(MobileDesign.canvas).padding(12.dp),
        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicTextField(text, { onText(it.take(4000)) }, modifier = Modifier.weight(1f).heightIn(min = 44.dp, max = 120.dp)
            .clip(RoundedCornerShape(12.dp)).background(MobileDesign.input)
            .border(1.dp, MobileDesign.stroke, RoundedCornerShape(12.dp)).padding(horizontal = 13.dp, vertical = 12.dp),
            textStyle = TextStyle(color = Color.White, fontSize = 16.sp), maxLines = 4, cursorBrush = SolidColorBrush(),
            decorationBox = { inner -> Box { if (text.isEmpty()) Text(placeholder, color = MobileDesign.muted, fontSize = 16.sp); inner() } })
        IconButton(onClick = onSend, enabled = enabled && !sending && text.isNotBlank(),
            modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(MobileDesign.gradient)) {
            if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MobileDesign.input)
            else Icon(Icons.AutoMirrored.Outlined.Send, "Отправить", tint = MobileDesign.input)
        }
    }
}

@Composable
internal fun MobileMessage(text: String, date: String, own: Boolean, modifier: Modifier = Modifier, content: (@Composable () -> Unit)? = null) {
    val shape = RoundedCornerShape(topStart = if (own) 14.dp else 0.dp, topEnd = if (own) 0.dp else 14.dp, bottomStart = 14.dp, bottomEnd = 14.dp)
    Surface(modifier, color = if (own) MobileDesign.outgoing else MobileDesign.incoming, shape = shape,
        border = BorderStroke(1.dp, if (own) Color(0xFF3D5073) else MobileDesign.stroke)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            content?.invoke()
            if (text.isNotBlank()) androidx.compose.foundation.text.selection.SelectionContainer {
                Text(text, fontSize = (14 * MobilePreferences.textScale).sp, lineHeight = (20 * MobilePreferences.textScale).sp)
            }
            if (date.isNotBlank()) Text(date, fontSize = 10.sp, color = MobileDesign.muted)
        }
    }
}

@Composable
internal fun MobileBottomNavigation(page: Int, onPage: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().background(MobileDesign.background).navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val icons = listOf(Icons.Outlined.Home, Icons.Outlined.ChatBubbleOutline, Icons.Outlined.PeopleOutline, Icons.Outlined.History)
        listOf("Главная", "Чаты", "Друзья", "История").forEachIndexed { index, label ->
            val selected = page == index
            val color = if (selected) MobileDesign.accent else MobileDesign.muted
            Column(Modifier.weight(1f).height(50.dp).clip(RoundedCornerShape(12.dp)).background(if (selected) MobileDesign.incoming else Color.Transparent)
                .selectable(selected, role = Role.Tab, onClick = { onPage(index) }), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(icons[index], null, Modifier.size(22.dp), tint = color)
                Text(label, fontSize = 10.sp, color = color, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}
