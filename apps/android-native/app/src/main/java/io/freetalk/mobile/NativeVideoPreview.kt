package io.freetalk.mobile

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import org.json.JSONObject

internal fun videoLink(text: String): String? = Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE).findAll(text).map { it.value.trimEnd('.', ',', ')') }.firstOrNull {
    val uri = runCatching { java.net.URI(it) }.getOrNull()
    uri?.rawUserInfo == null && uri?.host?.lowercase() in setOf("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "rutube.ru", "www.rutube.ru", "vk.com", "www.vk.com", "vkvideo.ru", "www.vkvideo.ru")
}

@Composable
internal fun NativeVideoPreview(api: FreeTalkApi, cache: MediaCache, accountId: String, text: String) {
    val url = remember(text) { videoLink(text) } ?: return
    val context = LocalContext.current
    var metadata by remember(url) { mutableStateOf<JSONObject?>(null) }
    var image by remember(url) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(url) {
        metadata = runCatching { api.videoPreview(url) }.getOrNull()
        metadata?.optString("imageKey")?.takeIf { Regex("^[a-f0-9]{64}$").matches(it) }?.let { key ->
            image = runCatching { cache.image(accountId, "preview-$key", false, System.currentTimeMillis() + 600_000) { api.previewImage(key) } }.getOrNull()
        }
    }
    metadata?.let { preview -> Surface(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) } }, color = MobileDesign.canvas, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, MobileDesign.stroke)) {
        Column(Modifier.widthIn(max = 420.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(MobileDesign.input), contentAlignment = Alignment.Center) {
                image?.let { AsyncImage(ImageRequest.Builder(context).data(it).diskCachePolicy(CachePolicy.DISABLED).build(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                Icon(Icons.Outlined.PlayCircle, "Открыть видео", Modifier.size(42.dp), tint = androidx.compose.ui.graphics.Color.White)
            }
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                MobileText(preview.optString("provider"), localize = false, color = MobileDesign.muted, fontSize = 11.sp)
                MobileText(preview.optString("title"), localize = false, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    } }
}
