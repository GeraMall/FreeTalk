package io.freetalk.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.ByteArrayOutputStream

private val tabletAvatars = java.util.concurrent.ConcurrentHashMap<String, String>()
internal suspend fun tabletAvatar(source: String): String? = withContext(Dispatchers.IO) {
    if (source.startsWith("data:image/") && source.length <= 18_000) return@withContext source
    tabletAvatars[source]?.let { return@withContext it }
    val url = source.toHttpUrlOrNull() ?: return@withContext null
    if (url.scheme != "https" || url.username.isNotEmpty() || url.password.isNotEmpty() ||
        url.host !in listOf("trlka.com", "freetalk.185-225-201-129.sslip.io", "freetalk.191-44-38-60.sslip.io") ||
        !Regex("^/api/v1/(?:users|chats)/[a-fA-F0-9-]{36}/avatar$").matches(url.encodedPath)) return@withContext null
    runCatching {
        val bytes = ByteArrayOutputStream()
        androidServers.execute(url.encodedPath.removePrefix("/api")) { it.build() }.use { response ->
            require(response.isSuccessful && response.body?.contentType()?.type == "image")
            response.body!!.byteStream().use { copyBounded(it, bytes, 4L * 1024 * 1024) }
        }
        val data = bytes.toByteArray()
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, options)
        require(options.outWidth in 1..8192 && options.outHeight in 1..8192)
        options.inSampleSize = 1
        while (options.outWidth / options.inSampleSize > 96 || options.outHeight / options.inSampleSize > 96) options.inSampleSize *= 2
        options.inJustDecodeBounds = false
        val image = BitmapFactory.decodeByteArray(data, 0, data.size, options) ?: error("Invalid avatar")
        val encoded = ByteArrayOutputStream()
        image.compress(Bitmap.CompressFormat.JPEG, 80, encoded); image.recycle()
        val result = "data:image/jpeg;base64," + Base64.encodeToString(encoded.toByteArray(), Base64.NO_WRAP)
        require(result.length <= 18_000)
        if (tabletAvatars.size > 64) tabletAvatars.clear()
        tabletAvatars[source] = result
        result
    }.getOrNull()
}
