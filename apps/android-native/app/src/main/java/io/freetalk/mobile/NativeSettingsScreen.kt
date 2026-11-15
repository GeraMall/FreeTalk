package io.freetalk.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.*
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.webkit.*
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.Camera2Enumerator
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

private const val SETTINGS_ORIGIN = "https://appassets.androidplatform.net"
private const val SETTINGS_PAGE = "$SETTINGS_ORIGIN/settings/android-settings.html"

/** Bundled React settings UI; credentials and privileged requests stay in Kotlin. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun NativeSettingsScreen(api: FreeTalkApi, cache: MediaCache, user: SignedInUser,
    onClose: () -> Unit, onUser: (SignedInUser) -> Unit, onLogout: () -> Unit,
    preview: Boolean = false, initialTab: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val offline = preview && BuildConfig.DEBUG
    val close by rememberUpdatedState(onClose)
    val userChanged by rememberUpdatedState(onUser)
    val logout by rememberUpdatedState(onLogout)
    var pageUser by remember(user.id) { mutableStateOf(user) }
    LaunchedEffect(user) { pageUser = user }
    remember(user.id) { NativeSettingsStore.load(context, user.id); true }
    var attempt by remember { mutableIntStateOf(0) }
    var ready by remember(attempt) { mutableStateOf(false) }
    var failed by remember(attempt) { mutableStateOf(false) }
    val alive = remember(attempt) { AtomicBoolean(true) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)?.filter { it.scheme == "content" }?.toTypedArray())
        fileCallback = null
    }
    var permissionResult by remember { mutableStateOf<CompletableDeferred<Boolean>?>(null) }
    val permissionLock = remember { Mutex() }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        permissionResult?.complete(result.values.all { it }); permissionResult = null
    }
    suspend fun permit(values: Array<String>): Boolean = permissionLock.withLock {
        val missing = values.filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) true else {
            val answer = CompletableDeferred<Boolean>(); permissionResult = answer
            permissions.launch(missing.toTypedArray()); answer.await()
        }
    }
    var directoryResult by remember { mutableStateOf<CompletableDeferred<Uri?>?>(null) }
    val directory = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        uri?.let { runCatching { context.contentResolver.takePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } }
        directoryResult?.complete(uri); directoryResult = null
    }
    var diagnosticResult by remember { mutableStateOf<CompletableDeferred<String>?>(null) }
    val diagnostic = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val answer = diagnosticResult; diagnosticResult = null
        if (uri == null) answer?.complete("") else scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)!!.bufferedWriter().use { it.write(CallDiagnostics.export()) } }
                "Trlka-Android-call.json"
            }.onSuccess { answer?.complete(it) }.onFailure { answer?.completeExceptionally(it) }
        }
    }
    val audio = remember { context.getSystemService(AudioManager::class.java) }
    val cameraFacing = remember { JSONObject().apply {
        runCatching { val cameras = Camera2Enumerator(context); cameras.deviceNames.forEach { put("native:$it", if (cameras.isFrontFacing(it)) "user" else "environment") } }
    } }
    fun devices(): JSONObject {
        fun device(id: String, name: String, kind: String) = JSONObject().put("deviceId", id).put("label", name).put("kind", kind).put("groupId", "")
        val inputs = JSONArray(); val outputs = JSONArray(); val cameras = JSONArray()
        runCatching { audio.getDevices(AudioManager.GET_DEVICES_INPUTS).forEach { inputs.put(device("native:${it.id}", it.productName.toString(), "audioinput")) } }
        if (Build.VERSION.SDK_INT >= 31) runCatching { audio.availableCommunicationDevices.forEach { outputs.put(device("native:${it.id}", it.productName.toString(), "audiooutput")) } }
        else { outputs.put(device("native:-2", "Динамик", "audiooutput")); outputs.put(device("native:-1", "Телефон", "audiooutput")); outputs.put(device("native:-3", "Bluetooth", "audiooutput")) }
        cameraFacing.keys().forEach { id -> cameras.put(device(id, if (cameraFacing.getString(id) == "user") "Фронтальная камера" else "Основная камера", "videoinput")) }
        return JSONObject().put("inputs", inputs).put("outputs", outputs).put("cameras", cameras)
    }
    fun accountJson(value: SignedInUser) = JSONObject().put("id", value.id).put("username", value.username)
        .put("displayName", value.displayName).put("email", value.email).put("emailVerified", value.emailVerified)
        .put("avatarUrl", value.avatarUrl ?: JSONObject.NULL).put("coverUrl", value.coverUrl ?: JSONObject.NULL)
        .put("bio", value.bio).put("registeredAt", value.registeredAt).put("canAccessStore", value.canAccessStore)

    suspend fun action(name: String, payload: JSONObject): Any {
        return when (name) {
            "bootstrap" -> {
                val settings = NativeSettingsStore.snapshot()
                if (!settings.has("chatTextScale")) settings.put("chatTextScale", MobilePreferences.textScale)
                if (!settings.has("mirrorSelfVideo")) settings.put("mirrorSelfVideo", MobilePreferences.mirrorSelf)
                if (!settings.has("screenResolution")) settings.put("screenResolution", "${MobilePreferences.shareQuality.shortEdge}p")
                if (!settings.has("screenFrameRate")) settings.put("screenFrameRate", MobilePreferences.shareQuality.fps)
                if (!settings.has("screenContentMode")) settings.put("screenContentMode", MobilePreferences.shareQuality.content.name.lowercase())
                settings.put("screenAudioByDefault", false)
                JSONObject().put("user", accountJson(pageUser)).put("settings", settings).put("theme", MobilePreferences.theme)
                    .put("language", MobilePreferences.language).put("version", BuildConfig.VERSION_NAME).put("devices", devices())
                    .put("cameraFacing", cameraFacing).apply { initialTab?.let { put("initialTab", it) } }
            }
            "api" -> {
                val path = payload.getString("path"); val method = payload.optString("method", "GET")
                require(NativeSettingsPolicy.allows(path, method))
                if (offline) when (path) {
                    "/v1/me/sessions" -> JSONObject().put("sessions", JSONArray())
                    "/v1/me/passkeys" -> JSONObject().put("keys", JSONArray())
                    "/v1/me/appearance" -> JSONObject().put("appearance", JSONObject().put("theme", payload.optJSONObject("body")?.optString("theme", MobilePreferences.theme) ?: MobilePreferences.theme).put("syncEnabled", payload.optJSONObject("body")?.optBoolean("syncEnabled") ?: false))
                    else -> throw ApiException("PREVIEW_ONLY", "В предпросмотре аккаунт не изменяется", 409)
                } else api.settingsRequest(path, method, payload.optJSONObject("body"))
            }
            "profile.save" -> {
                val nameValue = payload.getString("name"); val avatar = payload.optString("avatar"); val cover = payload.optString("cover"); val username = payload.optString("username", pageUser.username); val bio = payload.optString("bio")
                require(nameValue.length in 1..64 && bio.length <= 500 && avatar.length <= 6_000_000 && cover.length <= 6_000_000)
                val updated = if (offline) pageUser.copy(displayName = nameValue, username = username, bio = bio,
                    avatarUrl = avatar.takeIf { it.isNotEmpty() }, coverUrl = cover.takeIf { it.isNotEmpty() }) else withContext(Dispatchers.IO) {
                    if (nameValue != pageUser.displayName || username != pageUser.username || bio != pageUser.bio) api.saveSettingsProfile(nameValue, username, bio)
                    if (avatar != pageUser.avatarUrl.orEmpty()) api.settingsImage("avatar", avatar)
                    if (cover != pageUser.coverUrl.orEmpty()) api.settingsImage("cover", cover)
                    api.settingsUser(api.settingsRequest("/v1/me").getJSONObject("user"))
                }
                pageUser = updated; userChanged(updated)
                JSONObject().put("user", accountJson(updated))
            }
            "settings" -> {
                if (payload.optBoolean("screenAudioByDefault")) throw ApiException("UNSUPPORTED_FEATURE", "Передача системного звука на Android пока недоступна", 409)
                NativeSettingsStore.save(context, payload); JSONObject()
            }
            "typing" -> { NativeSettingsStore.markTyping(); JSONObject() }
            "ui.ready" -> JSONObject()
            "level" -> NativeSettingsStore.inputLevel
            "theme" -> { val theme = payload.getString("theme"); require(theme in setOf("default", "light", "black")); MobilePreferences.theme = theme; MobilePreferences.save(context); JSONObject() }
            "language" -> { val language = payload.getString("language"); require(language in setOf("ru", "en", "zh-CN", "kk", "be", "ka", "es")); MobilePreferences.language = language; MobilePreferences.save(context); JSONObject() }
            "reset" -> { NativeSettingsStore.reset(context); JSONObject() }
            "cache.stats" -> withContext(Dispatchers.IO) { JSONObject().put("bytes", cache.sizeBytes()).put("entries", 0) }
            "cache.clear" -> { withContext(Dispatchers.IO) { cache.clear() }; JSONObject() }
            "diagnostics" -> { val answer = CompletableDeferred<String>(); diagnosticResult = answer; diagnostic.launch("Trlka-Android-call-${System.currentTimeMillis()}.json"); answer.await() }
            "directory.default" -> "Видео/Trlka"
            "directory.available" -> StatFs(context.filesDir.path).availableBytes
            "directory.choose" -> { check(directoryResult == null); val answer = CompletableDeferred<Uri?>(); directoryResult = answer; directory.launch(payload.optString("current").takeIf { it.startsWith("content://") }?.let(Uri::parse)); answer.await()?.toString() ?: JSONObject.NULL }
            "directory.open" -> {
                val selected = payload.optString("directory")
                val uri = if (selected.startsWith("content://")) Uri.parse(selected) else android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Movies")
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "vnd.android.document/directory").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); JSONObject()
            }
            "microphone.sample" -> { check(permit(arrayOf(Manifest.permission.RECORD_AUDIO))) { "Разрешите доступ к микрофону" }; withContext(Dispatchers.IO) { recordSettingsSample(context) } }
            "update.check" -> JSONObject().put("kind", "unavailable")
            "update.open" -> { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://trlka.com/"))); JSONObject() }
            "logout" -> { if (!offline) logout(); JSONObject() }
            "close" -> { close(); JSONObject() }
            else -> throw IllegalArgumentException("Неподдерживаемое действие")
        }
    }
    val view = remember(user.id, attempt) {
        WebView(context).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(android.graphics.Color.rgb(4, 11, 20))
            settings.useWideViewPort = true
            settings.javaScriptEnabled = true; settings.domStorageEnabled = true
            settings.allowFileAccess = false; settings.allowContentAccess = true
            settings.javaScriptCanOpenWindowsAutomatically = false; settings.setSupportMultipleWindows(false)
            settings.mediaPlaybackRequiresUserGesture = false; settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null); fileCallback = callback
                    return runCatching { files.launch(params.createIntent()); true }.getOrElse { fileCallback = null; callback.onReceiveValue(null); false }
                }
                override fun onPermissionRequest(request: PermissionRequest) {
                    if (request.origin.toString().trimEnd('/') != SETTINGS_ORIGIN || request.resources.any { it !in setOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, PermissionRequest.RESOURCE_AUDIO_CAPTURE) }) { request.deny(); return }
                    scope.launch {
                        val required = request.resources.map { if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO }.toTypedArray()
                        if (permit(required) && alive.get()) request.grant(request.resources) else request.deny()
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.toString() == SETTINGS_PAGE) return false
                    if (request.isForMainFrame && request.hasGesture() && request.url.scheme == "https" && request.url.host in setOf("trlka.com", "github.com"))
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host in setOf("freetalk.185-225-201-129.sslip.io", "freetalk.191-44-38-60.sslip.io") &&
                        Regex("^/api/v1/users/[0-9a-fA-F-]{36}/(avatar|cover)$").matches(uri.path.orEmpty()) && request.method == "GET") return null
                    val path = uri.path.orEmpty().removePrefix("/")
                    val asset = when { path.startsWith("settings/") -> path; path.startsWith("sounds/") || path.startsWith("mediapipe/") -> "settings/$path"; else -> "" }
                    if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net" || asset.isEmpty() || asset.split('/').any { it == ".." || it.contains('\\') || it.contains('\u0000') })
                        return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    return try {
                        val mime = when (asset.substringAfterLast('.')) { "html" -> "text/html"; "js" -> "application/javascript"; "css" -> "text/css"; "woff2" -> "font/woff2"; "png" -> "image/png"; "svg" -> "image/svg+xml"; "wasm" -> "application/wasm"; "mp3" -> "audio/mpeg"; "wav" -> "audio/wav"; else -> "application/octet-stream" }
                        WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf("Content-Security-Policy" to "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://freetalk.185-225-201-129.sslip.io https://freetalk.191-44-38-60.sslip.io; media-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-src 'none'; base-uri 'self'; form-action 'none'"), context.assets.open(asset))
                    } catch (_: Exception) { WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { scope.launch { if (alive.get()) failed = true }; return true }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { if (request.isForMainFrame) scope.launch { if (alive.get()) failed = true } }
            }
            addJavascriptInterface(object {
                @JavascriptInterface fun postMessage(raw: String) {
                    if (raw.length > 13_000_000) return
                    val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
                    val id = message.optInt("id", -1)
                    val client = message.optString("client")
                    if (id < 0 || !Regex("^[a-fA-F0-9-]{36}$").matches(client)) return
                    post { scope.launch(Dispatchers.Main) {
                        if (!alive.get()) return@launch
                        val reply = JSONObject().put("id", id).put("client", client)
                        try {
                            reply.put("result", action(message.getString("action"), message.optJSONObject("payload") ?: JSONObject()))
                            if (message.optString("action") == "ui.ready") postVisualStateCallback(id.toLong(), object : WebView.VisualStateCallback() {
                                override fun onComplete(requestId: Long) { if (alive.get()) ready = true }
                            })
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (error: Exception) { reply.put("error", JSONObject().put("code", (error as? ApiException)?.code ?: "SETTINGS_ERROR").put("message", error.message ?: "Не удалось выполнить действие").put("status", (error as? ApiException)?.status ?: 400)) }
                        if (alive.get()) evaluateJavascript("window.receiveNativeSettings?.(JSON.parse(${JSONObject.quote(reply.toString())}))", null)
                    } }
                }
            }, "TRLKANativeSettings")
            post { if (alive.get()) loadUrl(SETTINGS_PAGE) }
        }
    }
    BackHandler { view.evaluateJavascript("window.nativeSettingsBack?.()", null) }
    DisposableEffect(view) { onDispose {
        alive.set(false); fileCallback?.onReceiveValue(null); fileCallback = null
        permissionResult?.cancel(); directoryResult?.cancel(); diagnosticResult?.cancel()
        view.removeJavascriptInterface("TRLKANativeSettings"); view.stopLoading(); view.destroy()
    } }
    LaunchedEffect(view) { delay(20_000); if (!ready) failed = true }
    Box(Modifier.fillMaxSize().background(MobileDesign.background).safeDrawingPadding().imePadding()) {
        if (!failed) key(view) { AndroidView(factory = { view }, modifier = Modifier.fillMaxSize()) }
        if (!ready && !failed) CircularProgressIndicator(Modifier.align(Alignment.Center), color = MobileDesign.accent)
        if (failed) Column(Modifier.align(Alignment.Center).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MobileText("Не удалось открыть настройки")
            WebButton(onClick = { attempt++ }) { MobileText("Повторить") }
            WebTextButton(onClick = onClose) { MobileText("Назад") }
        }
    }
}

@SuppressLint("MissingPermission")
private fun recordSettingsSample(context: Context): String {
    val sampleRate = 48000
    val recorder = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), sampleRate / 5)).build()
    try {
        val selected = NativeSettingsStore.string("inputDeviceId").removePrefix("native:").toIntOrNull()
        context.getSystemService(AudioManager::class.java).getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == selected }?.let { recorder.setPreferredDevice(it) }
        check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Не удалось открыть микрофон" }
        val pcm = ByteArray(sampleRate * 2 * 4)
        recorder.startRecording(); var offset = 0
        while (offset < pcm.size) {
            val read = recorder.read(pcm, offset, minOf(9600, pcm.size - offset)); check(read > 0) { "Не удалось записать микрофон" }
            var peak = 0
            for (i in offset until offset + read - 1 step 2) peak = maxOf(peak, kotlin.math.abs(((pcm[i].toInt() and 255) or (pcm[i + 1].toInt() shl 8)).toShort().toInt()))
            NativeSettingsStore.inputLevel = (peak / 10000f).coerceIn(0f, 1f)
            offset += read
        }
        recorder.stop()
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVEfmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(sampleRate); putInt(sampleRate * 2); putShort(2); putShort(16); put("data".toByteArray()); putInt(pcm.size)
        }.array()
        return "data:audio/wav;base64," + android.util.Base64.encodeToString(header + pcm, android.util.Base64.NO_WRAP)
    } finally { recorder.release(); NativeSettingsStore.inputLevel = 0f }
}
