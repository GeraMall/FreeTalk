package io.freetalk.mobile

import kotlin.math.*

internal data class CallTileFrame(val x: Float, val y: Float, val width: Float, val height: Float)
internal data class CallTileLayout(val frames: List<CallTileFrame>, val canvasHeight: Float) {
    companion object {
        // Same equal-area partition and aspect-ratio scoring as the iPhone client.
        fun calculate(rawWidth: Float, rawHeight: Float, rawCount: Int): CallTileLayout {
            val width = rawWidth.takeIf { it.isFinite() }?.coerceAtLeast(1f) ?: 1f
            val height = rawHeight.takeIf { it.isFinite() }?.coerceAtLeast(1f) ?: 1f
            val count = rawCount.coerceIn(1, 8)
            val gap = 10f
            val minimumRows = ceil(count.toFloat() / max(1, (width / 122).toInt())).toInt()
            val canvas = max(height, minimumRows * 112f + (minimumRows - 1) * gap)
            var best = emptyList<CallTileFrame>(); var bestScore = Float.POSITIVE_INFINITY
            for (rows in 1..count) {
                val counts = (0 until rows).map { count / rows + if (it < count % rows) 1 else 0 }
                val widths = counts.map { (width - gap * (it - 1)) / it }
                if (widths.any { it <= 0 } || canvas <= gap * (rows - 1)) continue
                val area = (canvas - gap * (rows - 1)) / widths.sumOf { 1.0 / it }.toFloat()
                val candidate = mutableListOf<CallTileFrame>(); var y = 0f; var score = 0f; var worst = 0f
                for (row in 0 until rows) {
                    val w = widths[row]; val h = area / w
                    val distortion = abs(ln(w / h)); worst = max(worst, distortion)
                    score += distortion * counts[row]
                    if (min(w, h) < 90) score += 20
                    repeat(counts[row]) { candidate += CallTileFrame(it * (w + gap), y, w, h) }
                    y += h + gap
                }
                score = score / count + worst * .3f
                if (score < bestScore) { bestScore = score; best = candidate }
            }
            return CallTileLayout(best, canvas)
        }
    }
}
