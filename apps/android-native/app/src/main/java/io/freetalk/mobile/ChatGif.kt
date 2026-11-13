package io.freetalk.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.decode.ImageDecoderDecoder
import coil.request.CachePolicy
import coil.request.ImageRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

data class ChatGif internal constructor(
    val assetId: String?, val url: String?, val previewUrl: String?, val label: String,
    val width: Int, val height: Int, val provider: String, val attributionUrl: String?, internal val metadata: String,
)

internal fun parseChatGif(json: JSONObject): ChatGif? {
    val asset = json.optString("assetId").takeIf { it.isNotBlank() }
    if (asset != null && runCatching { UUID.fromString(asset).toString() }.getOrNull() != asset.lowercase()) return null
    val provider = json.optJSONObject("attribution")?.optString("provider")
    val host = when (provider) {
        "KLIPY" -> "static.klipy.com"
        "Wikimedia Commons" -> "upload.wikimedia.org"
        "TRLKA" -> if (asset != null) null else return null
        else -> return null
    }
    fun external(key: String): String? {
        val link = json.optString(key).toHttpUrlOrNull() ?: return null
        return link.toString().takeIf { link.isHttps && link.host == host && link.port == 443 && link.username.isEmpty() && link.password.isEmpty() }
    }
    if (asset != null && provider != "TRLKA") return null
    val media = external("url")
    if (asset == null && media?.toHttpUrlOrNull()?.encodedPath?.endsWith(".gif", true) != true) return null
    val page = json.getJSONObject("attribution").optString("pageUrl").toHttpUrlOrNull()?.takeIf {
        it.isHttps && it.port == 443 && it.username.isEmpty() && it.password.isEmpty() &&
            ((provider == "KLIPY" && it.host == "klipy.com") || (provider == "Wikimedia Commons" && it.host == "commons.wikimedia.org"))
    }?.toString()
    return ChatGif(asset, media, external("previewUrl") ?: media, json.optString("alt", "GIF"),
        json.optInt("width").coerceIn(1, 4096), json.optInt("height").coerceIn(1, 4096), provider, page, json.toString())
}

private val gifClient = OkHttpClient.Builder().followRedirects(false).build()

@Composable
internal fun NativeGifImage(gif: ChatGif, api: FreeTalkApi, cache: MediaCache, accountId: String, full: Boolean,
    expiresAt: String? = null, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var bytes by remember(accountId, gif, full) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(gif, full) { mutableStateOf(false) }
    var attempt by remember(gif, full) { mutableIntStateOf(0) }
    LaunchedEffect(accountId, gif, full, attempt, expiresAt) {
        failed = false
        try {
            val expiry = expiresAt?.let { java.time.Instant.parse(it).toEpochMilli() }
            bytes = cache.image(accountId, "gif/" + (gif.assetId ?: gif.url), full, expiry) {
                gif.assetId?.let { api.gifAsset(it, !full) } ?: withContext(Dispatchers.IO) {
                    val url = if (full) gif.url else gif.previewUrl
                    gifClient.newCall(Request.Builder().url(requireNotNull(url)).build()).execute().use { response ->
                        val body = response.body ?: error("GIF не удалось загрузить")
                        require(response.isSuccessful && body.contentType()?.type == "image")
                        val length = 30L * 1024 * 1024
                        require(body.contentLength() <= length)
                        ByteArrayOutputStream().use { out -> body.byteStream().use { copyBounded(it, out, length) }; out.toByteArray() }
                    }
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { failed = true }
    }
    Box(modifier.background(MobileDesign.input), contentAlignment = Alignment.Center) {
        if (failed) TextButton(onClick = { bytes = null; attempt++ }) { MobileText("Повторить") }
        else bytes?.let { data ->
            val model = remember(context, data, full) { ImageRequest.Builder(context).data(data)
                .apply { if (full) decoderFactory(ImageDecoderDecoder.Factory()) }.memoryCachePolicy(CachePolicy.DISABLED)
                .diskCachePolicy(CachePolicy.DISABLED).build() }
            AsyncImage(model, gif.label, Modifier.fillMaxSize(), contentScale = ContentScale.Fit, onError = { failed = true })
        } ?: CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
    }
}

internal suspend fun uploadPickedGif(context: Context, uri: Uri, api: FreeTalkApi): ChatGif = withContext(Dispatchers.IO) {
    val file = File.createTempFile("chat-", ".gif", context.cacheDir)
    try {
        context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { copyBounded(input, it, 30L * 1024 * 1024) } } ?: error("Файл недоступен")
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
            require(info.mimeType == "image/gif" && info.size.width in 1..4096 && info.size.height in 1..4096) { "Выберите файл GIF." }
            // Raw RGBA plus PNG overhead stays within the server's 64 KiB thumbnail limit.
            val scale = minOf(1.0, 120.0 / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        val thumbnail = try { ByteArrayOutputStream().use { out ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out))
            check(out.size() <= 64 * 1024)
            out.toByteArray()
        } } finally { bitmap.recycle() }
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }?.filter { it.isLetterOrDigit() || it in " ._-" }?.take(160)?.takeIf { it.isNotBlank() } ?: "GIF"
        api.uploadGif(file, name, thumbnail)
    } finally { file.delete() }
}
