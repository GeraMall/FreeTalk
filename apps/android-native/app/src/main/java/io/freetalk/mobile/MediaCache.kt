package io.freetalk.mobile

import android.content.Context
import java.io.File

class MediaCache(context: Context) {
    val directory = File(context.cacheDir, "chat-media").apply { mkdirs() }
    private val maxBytes = 384L * 1024L * 1024L

    fun sizeBytes(): Long = directory.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    fun entryCount(): Int = directory.walkTopDown().count { it.isFile }

    fun clear() {
        directory.listFiles()?.forEach { it.deleteRecursively() }
        directory.mkdirs()
    }

    fun trim() {
        var total = sizeBytes()
        if (total <= maxBytes) return
        directory.walkTopDown().filter { it.isFile }.sortedBy { it.lastModified() }.forEach { file ->
            if (total <= maxBytes) return
            total -= file.length()
            file.delete()
        }
    }
}
