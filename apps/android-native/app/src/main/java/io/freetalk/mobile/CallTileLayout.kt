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

        fun calculate(rawWidth: Float, rawHeight: Float, rawCount: Int): CallTileLayout {
            val width = rawWidth.takeIf { it.isFinite() }?.coerceAtLeast(1f) ?: 1f
            val height = rawHeight.takeIf { it.isFinite() }?.coerceAtLeast(1f) ?: 1f
            val count = rawCount.coerceIn(0, 8)
            if (count == 0) return CallTileLayout(emptyList(), height)
            val gap = 10f
            val maxColumns = ((width + gap) / (112f + gap)).toInt().coerceIn(1, count)
            val minHeight = min(112f, height)
            var best = CallTileLayout(emptyList(), height)
            var bestScore = Float.POSITIVE_INFINITY
            for (columns in 1..maxColumns) {
                val rows = (count + columns - 1) / columns
                val tileWidth = (width - gap * (columns - 1)) / columns
                val tileHeight = max(minHeight, (height - gap * (rows - 1)) / rows)
                val canvas = rows * tileHeight + gap * (rows - 1)
                val score = abs(ln(tileWidth / tileHeight)) + (canvas - height).coerceAtLeast(0f) / height * 3f
                if (score >= bestScore) continue
                bestScore = score
                best = CallTileLayout(List(count) { index ->
                    val row = index / columns
                    val tilesInRow = min(columns, count - row * columns)
                    val rowWidth = tilesInRow * tileWidth + (tilesInRow - 1) * gap
                    CallTileFrame((width - rowWidth).coerceAtLeast(0f) / 2f + index % columns * (tileWidth + gap),
                        row * (tileHeight + gap), tileWidth, tileHeight)
                }, max(height, canvas))
            }
            return best
        }
    }
}
