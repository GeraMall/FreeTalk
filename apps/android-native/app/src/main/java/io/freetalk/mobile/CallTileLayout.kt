package io.freetalk.mobile

import kotlin.math.*

internal data class CallTileFrame(val x: Float, val y: Float, val width: Float, val height: Float)
internal data class CallTileLayout(val frames: List<CallTileFrame>, val canvasHeight: Float) {
    companion object {
        fun audio(width: Float, height: Float, count: Int): CallTileLayout {
            if (count == 0) return CallTileLayout(emptyList(), height)
            val gap = 10f
            val columns = when {
                width >= 900f && count >= 3 -> 3
                width >= 560f || count > 2 -> min(2, count)
                else -> 1
            }
            val gridWidth = min(width, if (columns == 3) 1080f else if (columns == 2) 820f else 460f)
            val tileWidth = ((gridWidth - gap * (columns - 1)) / columns).coerceAtLeast(1f)
            val tileHeight = (height * .24f).coerceIn(98f, 166f)
            val rows = ceil(count.toFloat() / columns).toInt()
            val gridHeight = rows * tileHeight + (rows - 1) * gap
            val top = ((height - gridHeight) / 2f).coerceAtLeast(0f)
            return CallTileLayout(List(count) { index ->
                val inRow = min(columns, count - index / columns * columns)
                val rowWidth = tileWidth * inRow + gap * (inRow - 1)
                CallTileFrame((width - rowWidth) / 2f + (index % columns) * (tileWidth + gap),
                    top + (index / columns) * (tileHeight + gap), tileWidth, tileHeight)
            }, max(height, gridHeight))
        }

        /** Keep the moveable PIP inside the viewport, including in split screen and after rotation. */
        fun preview(width: Float, height: Float, scale: Float, dx: Float, dy: Float): CallTileFrame {
            val inset = min(10f, min(width, height) / 12f)
            val aspect = if (width >= 600f) 16f / 9f else 4f / 5f
            val maxWidth = min((width - inset * 2f) * .55f, (height - inset * 2f) * aspect).coerceAtLeast(1f)
            val tileWidth = ((width * .28f).coerceIn(90f, 188f) * scale.coerceIn(.8f, 2f)).coerceIn(1f, maxWidth)
            val tileHeight = tileWidth / aspect
            val x = (width - inset - tileWidth + dx).coerceIn(inset, (width - inset - tileWidth).coerceAtLeast(inset))
            val y = (inset + dy).coerceIn(inset, (height - inset - tileHeight).coerceAtLeast(inset))
            return CallTileFrame(x, y, tileWidth, tileHeight)
        }

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
