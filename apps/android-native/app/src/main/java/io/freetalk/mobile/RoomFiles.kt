package io.freetalk.mobile

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Ephemeral attachments remain pinned to the signaling node that issued the room token. */
internal class RoomFiles(private val origin: String, private val token: String) {
    init {
        require(origin in listOf("https://freetalk.185-225-201-129.sslip.io", "https://freetalk.191-44-38-60.sslip.io"))
        require(Regex("^[a-fA-F0-9-]{36}$").matches(token))
    }
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).callTimeout(45, TimeUnit.SECONDS).build()
    private fun request(path: String) = Request.Builder().url("$origin/room-chat/files$path").header("Authorization", "Bearer $token")
    suspend fun upload(context: Context, uri: Uri): RoomFile = withContext(Dispatchers.IO) {
        var name = "Файл"
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) name = it.getString(0).orEmpty().replace(Regex("[\\r\\n/\\\\]"), "_").take(180).ifBlank { "Файл" }
        }
        val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
        val directory = File(context.cacheDir, "room-uploads").apply { mkdirs() }
        val file = File(directory, UUID.randomUUID().toString())
        try {
            context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { copyBounded(input, it, 10L * 1024 * 1024) } } ?: error("Файл недоступен")
            require(file.length() > 0) { "Пустой файл" }
            client.newCall(request("").header("x-file-name", URLEncoder.encode(name, "UTF-8").replace("+", "%20"))
                .post(file.asRequestBody(mime.toMediaTypeOrNull())).build()).execute().use { response ->
                check(response.isSuccessful) { "Не удалось загрузить файл. Максимальный размер — 10 МБ." }
                val j = JSONObject(response.body?.string().orEmpty()).getJSONObject("attachment")
                RoomFile(j.getString("id"), j.getString("name"), j.getLong("size"), j.getString("mime"), j.getBoolean("image"))
            }
        } finally { file.delete() }
    }
    suspend fun save(id: String, output: OutputStream) = withContext(Dispatchers.IO) {
        require(Regex("^[a-fA-F0-9-]{36}$").matches(id))
        client.newCall(request("/$id").build()).execute().use { response ->
            check(response.isSuccessful) { "Файл больше недоступен" }
            response.body?.byteStream()?.use { copyBounded(it, output, 10L * 1024 * 1024) } ?: error("Файл недоступен")
        }
    }
    suspend fun image(id: String): ByteArray = java.io.ByteArrayOutputStream().use { save(id, it); it.toByteArray() }
}
