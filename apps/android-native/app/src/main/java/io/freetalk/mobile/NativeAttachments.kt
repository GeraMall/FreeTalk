package io.freetalk.mobile

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

internal fun copyBounded(input: InputStream, output: OutputStream, maxBytes: Long): Long {
    var total = 0L
    val buffer = ByteArray(32 * 1024)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        total += count
        require(total <= maxBytes) { "Файл слишком большой" }
        output.write(buffer, 0, count)
    }
    return total
}

internal suspend fun uploadPickedAttachment(context: Context, api: FreeTalkApi, uri: Uri, chatId: String, caption: String, replyTo: String?): ChatMessage = withContext(Dispatchers.IO) {
    var name = "Файл"
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) name = it.getString(0).orEmpty().replace(Regex("[\\r\\n/\\\\]"), "_").take(180).ifBlank { "Файл" }
    }
    val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
    val image = mime in listOf("image/jpeg", "image/png", "image/webp")
    val limit = (if (image) 25L else 30L) * 1024 * 1024
    val directory = File(context.cacheDir, "uploads").apply { mkdirs() }
    val file = File(directory, UUID.randomUUID().toString())
    try {
        context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { copyBounded(input, it, limit) } } ?: error("Файл недоступен")
        require(file.length() > 0) { "Пустой файл" }
        api.uploadAttachment(chatId, file, name, mime, image, caption, replyTo)
    } finally { file.delete() }
}
