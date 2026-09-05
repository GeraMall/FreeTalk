package io.freetalk.mobile

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer

class NativeCallMedia(private val context: Context, private val signal: RoomSignaling) {
    val egl = EglBase.create()
    private val main = Handler(Looper.getMainLooper())
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val previousMode = audioManager.mode
    private val previousSpeaker = audioManager.isSpeakerphoneOn
    private val previousDevice = if (Build.VERSION.SDK_INT >= 31) audioManager.communicationDevice else null
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener { change -> if (change < 0) post { changeMuted(true); error = "Микрофон выключен: звук занят другим звонком" } }.build()
    private val module: JavaAudioDeviceModule
    private val factory: PeerConnectionFactory
    private val audioSource: AudioSource
    private val audio: AudioTrack
    private var stopped = false
    @Volatile private var lastSpeechAt = 0L
    @Volatile private var microphoneLevel = 0f
    var levels by mutableStateOf(emptyMap<String, Float>()); private set
    var muted by mutableStateOf(false); private set
    var camera by mutableStateOf(false); private set
    var sharing by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var speaking by mutableStateOf(emptySet<String>()); private set
    var videos by mutableStateOf(emptyMap<String, VideoTrack>()); private set
    var connections by mutableStateOf(emptyMap<String, String>()); private set
    private var ice = emptyList<PeerConnection.IceServer>()
    private val peers = mutableMapOf<String, Peer>()
    private val captures = mutableMapOf<String, Capture>()
    private data class Capture(val capturer: VideoCapturer, val source: VideoSource, val helper: SurfaceTextureHelper, val track: VideoTrack)
    private class Peer(val pc: PeerConnection) {
        var ignore = false
        val operations = SdpOperationQueue()
        var negotiationPending = false
        val candidates = mutableListOf<IceCandidate>()
        val channels = mutableListOf<DataChannel>()
        val senders = mutableMapOf<String, RtpSender>()
        val remoteTracks = mutableMapOf<String, VideoTrack>()
        var remoteSources: JSONObject? = null
    }
    init {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        selectDefaultRoute()
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        module = JavaAudioDeviceModule.builder(context).setSamplesReadyCallback { sample ->
            var peak = 0
            if (sample.audioFormat == android.media.AudioFormat.ENCODING_PCM_16BIT) {
                val bytes = sample.data
                for (i in 0 until bytes.size - 1 step 2) {
                    val value = ((bytes[i].toInt() and 255) or (bytes[i + 1].toInt() shl 8)).toShort().toInt()
                    peak = maxOf(peak, kotlin.math.abs(value))
                }
            }
            if (peak > 700) lastSpeechAt = android.os.SystemClock.elapsedRealtime()
            microphoneLevel = (peak / 10000f).coerceIn(0f, 1f)
        }.createAudioDeviceModule()
        factory = PeerConnectionFactory.builder().setAudioDeviceModule(module)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext)).createPeerConnectionFactory()
        audioSource = factory.createAudioSource(MediaConstraints().apply {
            listOf("googEchoCancellation", "googAutoGainControl", "googNoiseSuppression").forEach {
                optional.add(MediaConstraints.KeyValuePair(it, "true"))
            }
        })
        audio = factory.createAudioTrack("microphone", audioSource)
        if (audioManager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) changeMuted(true)
        signal.onSignal = ::accept
        signal.pendingSignals.toList().forEach(::accept); signal.pendingSignals.clear()
        signal.room.peers.filter { it.id != signal.room.selfId }.forEach { ensure(it.id) }
        main.post { stats.run() }
    }
    private fun post(action: () -> Unit) { main.post { if (!stopped) action() } }
    private fun observer(failure: (String?) -> Unit, success: () -> Unit) = object : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription?) {}
        override fun onSetSuccess() = post(success)
        override fun onCreateFailure(message: String?) = post { failure(message) }
        override fun onSetFailure(message: String?) = post { failure(message) }
    }
    private fun ensure(id: String): Peer {
        peers[id]?.let { return it }
        val config = PeerConnection.RTCConfiguration(ice).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        val pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = post {
                connections = connections + (id to when (state) {
                    PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> "Подключён"
                    PeerConnection.IceConnectionState.FAILED -> "Ошибка связи"
                    PeerConnection.IceConnectionState.DISCONNECTED -> "Связь потеряна"
                    else -> "Подключение…"
                })
                if (state == PeerConnection.IceConnectionState.FAILED) peers[id]?.pc?.restartIce()
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(c: IceCandidate) { post { signal.send(JSONObject().put("type", "ice-candidate").put("to", id).put("candidate", JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex))) } }
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(channel: DataChannel) = post { channel(id, channel) }
            override fun onRenegotiationNeeded() = post { negotiate(id) }
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = post {
                val track = receiver.track()
                if (track is VideoTrack) { peers[id]?.remoteTracks?.put(track.id(), track); refreshRemoteVideo(id) }
            }
        }) ?: error("Не удалось создать медиасоединение")
        val peer = Peer(pc); peers[id] = peer
        pc.addTrack(audio, listOf("audio"))
        captures.forEach { (source, c) -> peer.senders[source] = pc.addTrack(c.track, listOf(source)) }
        if (signal.room.selfId < id) channel(id, pc.createDataChannel("freetalk-video-state-v1", DataChannel.Init()))
        return peer
    }
    private fun negotiate(id: String) {
        val p = peers[id] ?: return
        p.negotiationPending = true
        p.operations.submit { done ->
            if (peers[id] !== p || !p.negotiationPending || p.pc.signalingState() != PeerConnection.SignalingState.STABLE) done()
            else { p.negotiationPending = false; createDescription(id, p, true, done) }
        }
    }
    private fun createDescription(id: String, p: Peer, offer: Boolean, done: () -> Unit) {
        val fail: (String?) -> Unit = { message ->
            if (peers[id] === p) error = message ?: "Ошибка подключения"
            done()
        }
        val obs = object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) = post {
                if (peers[id] !== p) { done(); return@post }
                p.pc.setLocalDescription(observer(fail) {
                    if (peers[id] !== p) { done(); return@observer }
                    signal.send(JSONObject().put("type", if (offer) "offer" else "answer").put("to", id)
                        .put("description", JSONObject().put("type", sdp.type.canonicalForm()).put("sdp", sdp.description)))
                    publishVideo(p)
                    done()
                    if (!offer && p.negotiationPending) negotiate(id)
                }, sdp)
            }
            override fun onCreateFailure(message: String?) = post { fail(message) }
            override fun onSetSuccess() {}
            override fun onSetFailure(message: String?) {}
        }
        if (offer) p.pc.createOffer(obs, MediaConstraints()) else p.pc.createAnswer(obs, MediaConstraints())
    }
    fun accept(j: JSONObject) {
        if (stopped) return
        when (j.optString("type")) {
            "ice-config" -> {
                val list = j.getJSONArray("iceServers")
                ice = (0 until list.length()).map { i ->
                    val s = list.getJSONObject(i); val urls = s.optJSONArray("urls")
                    PeerConnection.IceServer.builder(if (urls == null) listOf(s.getString("urls")) else (0 until urls.length()).map { urls.getString(it) })
                        .setUsername(s.optString("username")).setPassword(s.optString("credential")).createIceServer()
                }
                peers.values.forEach { it.pc.setConfiguration(PeerConnection.RTCConfiguration(ice).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }) }
            }
            "participant-joined" -> ensure(j.getJSONObject("participant").getString("id"))
            "participant-left" -> {
                val id = j.getString("participantId"); videos = videos.filterKeys { !it.startsWith("$id:") }
                peers.remove(id)?.let { it.operations.close(); it.pc.close() }; connections = connections - id
            }
            "offer", "answer" -> {
                val id = j.getString("from"); val p = ensure(id); val offer = j.getString("type") == "offer"
                val description = j.getJSONObject("description")
                p.operations.submit { done ->
                    if (peers[id] !== p) { done(); return@submit }
                    // A delayed answer to a rolled-back offer must not touch a stable connection.
                    if (!offer && p.pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                        done(); return@submit
                    }
                    val collision = offer && p.pc.signalingState() != PeerConnection.SignalingState.STABLE
                    p.ignore = collision && signal.room.selfId < id
                    if (p.ignore) { done(); return@submit }
                    val fail: (String?) -> Unit = { message -> error = message ?: "Ошибка подключения"; done() }
                    val apply = {
                        p.pc.setRemoteDescription(observer(fail) {
                            if (peers[id] !== p) { done(); return@observer }
                            p.candidates.forEach { p.pc.addIceCandidate(it) }; p.candidates.clear()
                            if (offer) createDescription(id, p, false, done)
                            else {
                                done()
                                if (p.negotiationPending) negotiate(id)
                            }
                        }, SessionDescription(if (offer) SessionDescription.Type.OFFER else SessionDescription.Type.ANSWER, description.getString("sdp")))
                    }
                    if (collision) p.pc.setLocalDescription(observer(fail, apply), SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                    else apply()
                }
            }
            "ice-candidate" -> {
                val p = ensure(j.getString("from"))
                val c = j.getJSONObject("candidate"); val candidate = IceCandidate(if (c.isNull("sdpMid")) null else c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.getString("candidate"))
                p.operations.submit { done ->
                    if (!p.ignore) {
                        if (p.pc.remoteDescription == null) { if (p.candidates.size < 128) p.candidates.add(candidate) } else p.pc.addIceCandidate(candidate)
                    }
                    done()
                }
            }
            "force-mute" -> changeMuted(true)
        }
    }
    private fun channel(id: String, c: DataChannel) {
        val p = peers[id] ?: return
        p.channels.add(c)
        c.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previous: Long) {}
            override fun onStateChange() = post { publishVideo(p) }
            override fun onMessage(buffer: DataChannel.Buffer) = post {
                if (buffer.binary) return@post
                val bytes = ByteArray(buffer.data.remaining()); buffer.data.get(bytes)
                val message = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return@post
                if (message.optString("request") == "video-state") publishVideo(p)
                message.optJSONObject("sources")?.let { p.remoteSources = it; refreshRemoteVideo(id) }
            }
        })
    }
    private fun refreshRemoteVideo(id: String) {
        val p = peers[id] ?: return
        val sources = p.remoteSources
        val activeIds = if (sources == null) p.remoteTracks.keys else listOf("camera", "screen").mapNotNull {
            sources.optJSONObject(it)?.takeIf { source -> source.optBoolean("active") }?.optString("trackId")
        }.toSet()
        videos = videos.filterKeys { !it.startsWith("$id:") } + p.remoteTracks.filterKeys { it in activeIds }.mapKeys { "$id:${it.key}" }
    }
    private fun publishVideo(p: Peer) {
        val sources = JSONObject()
        listOf("camera", "screen").forEach { source ->
            val sender = p.senders[source]
            val mid = p.pc.transceivers.firstOrNull { it.sender.id() == sender?.id() }?.mid
            sources.put(source, JSONObject().put("active", captures.containsKey(source)).put("mid", mid ?: JSONObject.NULL).put("trackId", captures[source]?.track?.id() ?: JSONObject.NULL))
        }
        val bytes = JSONObject().put("version", 2).put("sources", sources).toString().toByteArray()
        p.channels.filter { it.state() == DataChannel.State.OPEN }.forEach { it.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false)) }
    }
    fun changeMuted(value: Boolean) { audio.setEnabled(!value); muted = value; signal.send(JSONObject().put("type", "mute-changed").put("muted", value)) }
    fun startCamera() {
        runCatching {
            val enumerator = Camera2Enumerator(context)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.first()
            startCapture("camera", enumerator.createCapturer(name, null), 640, 480, 24); camera = true
        }.onFailure { error = it.message ?: "Камера недоступна" }
    }
    fun switchCamera() {
        (captures["camera"]?.capturer as? CameraVideoCapturer)?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFrontCamera: Boolean) {}
            override fun onCameraSwitchError(message: String?) = post { error = message ?: "Не удалось переключить камеру" }
        })
    }
    fun startScreen(data: Intent) {
        runCatching {
            val display = context.resources.displayMetrics
            val scale = minOf(720f / display.widthPixels, 1280f / display.heightPixels)
            val width = ((display.widthPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
            val height = ((display.heightPixels * scale).toInt() / 2 * 2).coerceAtLeast(2)
            startCapture("screen", ScreenCapturerAndroid(data, object : MediaProjection.Callback() {
                override fun onStop() = post { stopCapture("screen") }
            }), width, height, 15); sharing = true
        }.onFailure { error = it.message ?: "Не удалось показать экран" }
    }
    private fun startCapture(name: String, capturer: VideoCapturer, width: Int, height: Int, fps: Int) {
        if (captures.containsKey(name)) return
        val source = factory.createVideoSource(name == "screen")
        val helper = SurfaceTextureHelper.create("capture-$name", egl.eglBaseContext)
        val track = factory.createVideoTrack(name, source)
        try { capturer.initialize(helper, context, source.capturerObserver); capturer.startCapture(width, height, fps) }
        catch (e: Exception) { capturer.dispose(); helper.dispose(); track.dispose(); source.dispose(); throw e }
        captures[name] = Capture(capturer, source, helper, track)
        videos = videos + ("self:$name" to track)
        peers.forEach { (id, p) -> p.senders[name] = p.pc.addTrack(track, listOf(name)); negotiate(id); publishVideo(p) }
    }
    fun stopCapture(name: String) {
        val c = captures.remove(name) ?: return
        videos = videos - "self:$name"
        peers.forEach { (id, p) -> p.senders.remove(name)?.let { p.pc.removeTrack(it) }; publishVideo(p); negotiate(id) }
        runCatching { c.capturer.stopCapture() }; c.capturer.dispose(); c.helper.dispose(); c.track.dispose(); c.source.dispose()
        if (name == "camera") camera = false else sharing = false
    }
    @Suppress("DEPRECATION")
    private fun selectDefaultRoute() {
        val external = setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET)
        if (Build.VERSION.SDK_INT >= 31) {
            val devices = audioManager.availableCommunicationDevices
            val device = devices.firstOrNull { it.type in external }
                ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            if (device != null && !audioManager.setCommunicationDevice(device)) error = "Выберите устройство звука в меню микрофона"
        } else {
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            audioManager.isSpeakerphoneOn = devices.none { it.type in external }
            if (devices.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }) audioManager.startBluetoothSco()
        }
    }
    fun routes(): List<Pair<Int, String>> = if (Build.VERSION.SDK_INT >= 31) audioManager.availableCommunicationDevices.map { it.id to when (it.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Динамик"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Телефон"
        else -> it.productName.toString()
    } } else listOf(-1 to "Телефон / наушники", -2 to "Динамик", -3 to "Bluetooth")
    @Suppress("DEPRECATION")
    fun route(id: Int) {
        if (Build.VERSION.SDK_INT >= 31) {
            val device = audioManager.availableCommunicationDevices.firstOrNull { it.id == id } ?: return
            if (!audioManager.setCommunicationDevice(device)) error = "Не удалось переключить звук"
        } else { audioManager.isSpeakerphoneOn = id == -2; if (id == -3) audioManager.startBluetoothSco() else audioManager.stopBluetoothSco() }
    }
    private val stats: Runnable = object : Runnable {
        override fun run() {
            if (stopped) return
            levels = levels + (signal.room.selfId to if (muted) 0f else microphoneLevel)
            speaking = (speaking - signal.room.selfId) + if (!muted && android.os.SystemClock.elapsedRealtime() - lastSpeechAt < 400) setOf(signal.room.selfId) else emptySet()
            peers.forEach { (id, p) -> p.pc.getStats { report ->
                val level = report.statsMap.values.filter { it.type == "inbound-rtp" }
                    .mapNotNull { (it.members["audioLevel"] as? Number)?.toFloat() }.maxOrNull() ?: 0f
                post {
                    levels = levels + (id to (level * 4f).coerceIn(0f, 1f))
                    speaking = (speaking - id) + (if (level > 0.015f) setOf(id) else emptySet())
                }
            } }
            main.postDelayed(this, 350)
        }
    }
    fun close() {
        if (stopped) return
        stopped = true; signal.onSignal = null; main.removeCallbacksAndMessages(null)
        videos = emptyMap()
        peers.values.forEach { it.operations.close(); it.pc.close() }; peers.clear()
        captures.keys.toList().forEach(::stopCapture)
        audio.dispose(); audioSource.dispose(); factory.dispose(); module.release()
        if (Build.VERSION.SDK_INT >= 31) {
            if (previousDevice == null || !audioManager.setCommunicationDevice(previousDevice)) audioManager.clearCommunicationDevice()
        }
        else { audioManager.stopBluetoothSco(); audioManager.isSpeakerphoneOn = previousSpeaker }
        audioManager.mode = previousMode
        audioManager.abandonAudioFocusRequest(focus)
        // Release the root context after Compose has released the room's renderers.
        main.post { egl.release() }
    }
}
