package io.freetalk.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

internal enum class ShareContent(val label: String) {
    Text("Текст · максимальная чёткость"), Balanced("Универсальный · чётко и плавно"), Video("Видео · плавное движение")
}

internal data class ScreenShareQuality(val shortEdge: Int = 1080, val fps: Int = 30, val content: ShareContent = ShareContent.Balanced) {
    fun dimensions(width: Int, height: Int): Pair<Int, Int> {
        val longEdge = when (shortEdge) { 720 -> 1280; 1440 -> 2560; else -> 1920 }
        val ratio = minOf(1.0, shortEdge.toDouble() / minOf(width, height).coerceAtLeast(1),
            longEdge.toDouble() / maxOf(width, height).coerceAtLeast(1))
        return even(width * ratio) to even(height * ratio)
    }
    private fun even(size: Double) = (size.toInt() / 2 * 2).coerceAtLeast(2)
}

@Composable
internal fun ScreenShareOptions() {
    val context = LocalContext.current
    val quality = MobilePreferences.shareQuality
    fun update(value: ScreenShareQuality) {
        MobilePreferences.shareQuality = value
        MobilePreferences.save(context)
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ShareChoice("Тип содержимого", quality.content, ShareContent.entries.toList(), { it.label }) { update(quality.copy(content = it)) }
        ShareChoice("Максимальное разрешение", quality.shortEdge, listOf(720, 1080, 1440),
            { when (it) { 720 -> "HD · 1280×720"; 1440 -> "2K · 2560×1440"; else -> "Full HD · 1920×1080" } }) { update(quality.copy(shortEdge = it)) }
        ShareChoice("Частота кадров", quality.fps, listOf(15, 30, 60), { "$it FPS" }) { update(quality.copy(fps = it)) }
    }
}

@Composable
private fun <T> ShareChoice(label: String, selected: T, values: List<T>, text: (T) -> String, onSelect: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    MobileText(label)
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { MobileText(text(selected)) }
        DropdownMenu(open, { open = false }) {
            values.forEach { value -> DropdownMenuItem(text = { MobileText(text(value)) }, onClick = { onSelect(value); open = false }) }
        }
    }
}
