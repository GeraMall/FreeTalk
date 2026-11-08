package io.freetalk.mobile

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

private const val TABLET_ORIGIN = "https://appassets.androidplatform.net"
private const val TABLET_PAGE = "$TABLET_ORIGIN/tablet/android-tablet.html"

/** No bearer tokens, browsing, iframes, file access, or arbitrary signaling messages in this view. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun NativeTablet(signaling: RoomSignaling, media: NativeCallMedia?, onClose: () -> Unit) {
    val context = LocalContext.current
    val state = signaling.room
    var ready by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var avatars by remember { mutableStateOf(emptyMap<String, String>()) }
    LaunchedEffect(state.peers.map { it.id to it.avatar }) {
        for (peer in state.peers) peer.avatar?.let { source ->
            tabletAvatar(source)?.let { embedded -> avatars = avatars + (peer.id to embedded) }
        }
    }
    val latestClose by rememberUpdatedState(onClose)
    val latestMedia by rememberUpdatedState(media)
    val handler = remember { Handler(Looper.getMainLooper()) }
    var alive by remember { mutableStateOf(true) }
    val view = remember {
        WebView(context).apply {
            setBackgroundColor(android.graphics.Color.rgb(6, 12, 21))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.toString() != TABLET_PAGE
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    val uri = request.url
                    val path = uri.path.orEmpty().removePrefix("/")
                    val local = uri.scheme == "https" && uri.host == "appassets.androidplatform.net"
                    val asset = when {
                        path.startsWith("tablet/") -> path
                        path.startsWith("sounds/") -> "tablet/$path"
                        else -> ""
                    }
                    if (!local || asset.isEmpty() || asset.split('/').any { it == ".." || it.contains('\\') })
                        return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    return try {
                        val mime = when (asset.substringAfterLast('.')) {
                            "html" -> "text/html"; "js" -> "application/javascript"; "css" -> "text/css"
                            "woff2" -> "font/woff2"; "png" -> "image/png"; "svg" -> "image/svg+xml"
                            "wav" -> "audio/wav"; "mp3" -> "audio/mpeg"; else -> "application/octet-stream"
                        }
                        WebResourceResponse(mime, "UTF-8", context.assets.open(asset))
                    } catch (_: Exception) {
                        WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    handler.post { if (alive) failed = true }
                    return true
                }
            }
            addJavascriptInterface(object {
                @JavascriptInterface fun postMessage(raw: String) {
                    if (raw.length > 32_768) return
                    val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
                    handler.post {
                        if (!alive) return@post
                        when (message.optString("type")) {
                            "ready" -> { ready = true; failed = false }
                            "close" -> latestClose()
                            "mute" -> latestMedia?.let { it.changeMuted(!it.muted) }
                            "deafen" -> latestMedia?.let { it.changeDeafened(!it.deafened) }
                            "action" -> message.optJSONObject("action")?.let { action ->
                                if (Regex("^[a-z-]{1,48}$").matches(action.optString("kind"))) signaling.activity(action)
                            }
                        }
                    }
                }
            }, "TRLKANativeTablet")
            loadUrl(TABLET_PAGE)
        }
    }
    val payload = JSONObject().apply {
        put("activity", state.activity?.let { JSONObject(it) })
        put("selfId", state.selfId)
        put("language", MobilePreferences.language)
        put("theme", MobilePreferences.theme)
        put("muted", media?.muted != false); put("deafened", media?.deafened == true)
        put("participants", JSONArray().apply { state.peers.forEach { peer -> put(JSONObject().apply {
            put("id", peer.id); put("name", peer.name); put("muted", peer.muted); put("deafened", peer.deafened)
            put("isOwner", peer.owner); put("connectedAt", 0)
            avatars[peer.id]?.let { put("avatar", it) }
            put("speaking", media?.speaking?.contains(peer.id) == true)
        }) } })
    }.toString()
    LaunchedEffect(payload, ready) {
        if (ready) view.evaluateJavascript("window.TRLKATablet?.receive(${JSONObject.quote(payload)})", null)
    }
    LaunchedEffect(state.pointer, ready) {
        if (ready && state.pointer != null) view.evaluateJavascript("window.TRLKATablet?.pointer(${JSONObject.quote(state.pointer)})", null)
    }
    LaunchedEffect(view) { delay(15_000); if (!ready) failed = true }
    DisposableEffect(view) {
        onDispose {
            alive = false
            signaling.activity(JSONObject().put("kind", "tablet-join").put("joined", false))
            view.removeJavascriptInterface("TRLKANativeTablet")
            view.stopLoading(); view.destroy()
        }
    }
    Box(Modifier.fillMaxSize().background(MobileDesign.background)) {
        AndroidView(factory = { view }, modifier = Modifier.fillMaxSize())
        if (!ready || failed) Column(Modifier.fillMaxSize().background(MobileDesign.background).padding(24.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            if (!failed) CircularProgressIndicator() else {
                MobileText("Не удалось открыть планшет. Звонок продолжается.")
                TextButton(onClick = latestClose) { MobileText("Вернуться в звонок") }
            }
        }
    }
}
