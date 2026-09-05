package io.freetalk.mobile

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
fun VoiceLevelIndicator(level: Float, speaking: Boolean, modifier: Modifier = Modifier) {
    // No looping/random animation: only measured microphone/RTP amplitude drives the bars.
    val amplitude by animateFloatAsState(if (speaking) level.coerceIn(0f, 1f) else 0f, tween(140), label = "voice-level")
    Canvas(modifier.size(34.dp, 24.dp).semantics { contentDescription = if (speaking) "Говорит" else "Нет голоса" }) {
        val profile = floatArrayOf(0.7f, 1f, 0.4f, 0.85f, 0.55f, 0.95f, 0.35f)
        profile.forEachIndexed { index, scale ->
            val height = 2.dp.toPx() + (size.height - 2.dp.toPx()) * amplitude * scale
            val x = size.width * (index + 0.5f) / profile.size
            drawLine(if (speaking) Color(0xFF4EF3F2) else Color(0xFF385568), Offset(x, (size.height - height) / 2), Offset(x, (size.height + height) / 2), strokeWidth = 1.4.dp.toPx(), cap = StrokeCap.Round)
        }
    }
}
