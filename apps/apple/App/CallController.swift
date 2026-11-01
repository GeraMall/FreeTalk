import SwiftUI
import AVFoundation
import WebRTC
import TRLKACore

@MainActor @Observable
final class CallController {
    enum Phase { case idle, preparing, connecting, connected, reconnecting }
    var phase: Phase = .idle
    var roomID = ""
    var title = "Звонок"
    var selfID = ""
    var participants: [RoomParticipant] = []
    var muted = false
    var cameraOn = false
    var cameraBusy = false
    var speaker = true
    var presented = false
    var error: String?
    var startedAt = Date()
    var revision = 0
    var localVideo: RTCVideoTrack?
    var busy: Bool { phase == .preparing }
    var active: Bool { phase != .idle }
    private let client: AccountClient
    private let socket = SocketChannel()
    private var factory: RTCPeerConnectionFactory?
    private var audioSource: RTCAudioSource?
    private var audio: RTCAudioTrack?
    private var cameraSource: RTCVideoSource?
    private var capturer: RTCCameraVideoCapturer?
    private var cameraDevice: AVCaptureDevice?
    private var peers: [String: MediaPeer] = [:]
    private var ice: [RTCIceServer] = [RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])]
    private var generation = 0
    private var cameraGeneration = 0
    private var ringTask: Task<Void, Never>?
    private var chatID: String?
    private var ringMembers: [String] = []
    private var shouldCreate = false
    #if os(iOS)
    private var interruptionObserver: NSObjectProtocol?
    private var previousAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    #endif

    init(client: AccountClient) {
        self.client = client
        socket.onMessage = { [weak self] in self?.receive($0) }
        socket.onConnection = { [weak self] connected in
            guard let self, active else { return }
            if !connected { phase = .reconnecting }
        }
        socket.onFailure = { [weak self] _ in
            guard let self, active else { return }; phase = .reconnecting
        }
    }

    func start(user: AccountUser, chat: Chat? = nil, join code: String? = nil) async {
        #if DEBUG
        if PreviewFixtures.mode != nil { error = "В снимке интерфейса звонки отключены."; return }
        #endif
        if active { presented = true; return }
        generation += 1
        let expected = generation
        phase = .preparing; error = nil; presented = true
        do {
            guard await AVCaptureDevice.requestAccess(for: .audio) else {
                throw APIError(status: 0, code: "MIC_PERMISSION", message: "Разрешите доступ к микрофону в настройках iPhone для TRLKA.")
            }
            guard expected == generation else { return }
            var create = code == nil
            var room = try code.map(RoomCode.parse) ?? RoomCode.generate()
            if let chat {
                if let existing = try await client.activeCall(chatID: chat.id) { room = existing.roomId; create = false }
                else { try await client.registerCall(chatID: chat.id, roomID: room) }
            }
            guard expected == generation else { return }
            try configureAudio()
            RTCInitializeSSL()
            let factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
            self.factory = factory
            let source = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["googEchoCancellation": "true", "googNoiseSuppression": "true"]))
            audioSource = source
            audio = factory.audioTrack(with: source, trackId: "microphone")
            audio?.isEnabled = !muted
            roomID = room; title = chat?.name(currentUserID: user.id) ?? "Комната TRLKA"
            chatID = chat?.id
            ringMembers = create ? (chat?.members.filter { $0.id != user.id }.map(\.id) ?? []) : []
            shouldCreate = create
            let participantID = UUID().uuidString.lowercased()
            let sessionID = UUID().uuidString.lowercased()
            phase = .connecting
            let url = try await client.signalingURL(roomID: room)
            socket.start(url: url, roomHeartbeat: true) { [weak self] in
                guard let self, active else { throw CancellationError() }
                let token = try await client.realtimeToken()
                return ["type": shouldCreate ? "create-room" : "join-room", "roomId": room,
                        "clientId": participantID, "sessionId": sessionID, "authToken": token,
                        "name": user.displayName, "cardStyle": "avatar-glass"]
            }
        } catch {
            guard expected == generation else { return }
            end(); self.error = error.localizedDescription
        }
    }

    private func receive(_ message: [String: Any]) {
        guard active, let type = message["type"] as? String else { return }
        switch type {
        case "ice-config":
            ice = (message["iceServers"] as? [[String: Any]] ?? []).compactMap { value in
                let urls = value["urls"] as? [String] ?? (value["urls"] as? String).map { [$0] } ?? []
                guard !urls.isEmpty else { return nil }
                return RTCIceServer(urlStrings: urls, username: value["username"] as? String ?? "", credential: value["credential"] as? String ?? "")
            }
            peers.values.forEach { $0.updateICE(ice) }
        case "joined-room":
            guard let id = message["selfId"] as? String else { return }
            let rejoining = !selfID.isEmpty
            selfID = id; shouldCreate = false
            if rejoining { peers.values.forEach { $0.close() }; peers.removeAll() }
            participants = decode([RoomParticipant].self, message["participants"]) ?? []
            if let timestamp = message["roomStartedAt"] as? Double { startedAt = Date(timeIntervalSince1970: timestamp / 1000) }
            else if !rejoining { startedAt = Date() }
            participants.filter { $0.id != selfID }.forEach { _ = ensure($0.id) }
            socket.send(["type": "mute-changed", "muted": muted])
            refreshPhase(); sendInvitations()
        case "participants":
            let updated = decode([RoomParticipant].self, message["participants"]) ?? participants
            let ids = Set(updated.map(\.id))
            for id in Array(peers.keys) where !ids.contains(id) { peers.removeValue(forKey: id)?.close() }
            participants = updated
            updated.filter { $0.id != selfID }.forEach { _ = ensure($0.id) }
            refreshPhase()
        case "participant-joined", "participant-updated":
            guard let participant = decode(RoomParticipant.self, message["participant"]) else { return }
            if let index = participants.firstIndex(where: { $0.id == participant.id }) { participants[index] = participant }
            else { participants.append(participant) }
            if participant.id != selfID { _ = ensure(participant.id) }
            refreshPhase()
        case "participant-left":
            guard let id = message["participantId"] as? String else { return }
            participants.removeAll { $0.id == id }; peers.removeValue(forKey: id)?.close(); refreshPhase()
        case "mute-changed":
            if let id = message["participantId"] as? String, let index = participants.firstIndex(where: { $0.id == id }), let muted = message["muted"] as? Bool { participants[index].muted = muted }
        case "force-mute": setMuted(true)
        case "offer", "answer":
            guard let id = message["from"] as? String, let description = message["description"] as? [String: Any], let sdp = description["sdp"] as? String, sdp.utf8.count <= 24000 else { return }
            ensure(id)?.description(type: type, sdp: sdp)
        case "ice-candidate":
            guard let id = message["from"] as? String, let value = message["candidate"] as? [String: Any], let sdp = value["candidate"] as? String, sdp.utf8.count <= 8000 else { return }
            ensure(id)?.candidate(RTCIceCandidate(sdp: sdp, sdpMLineIndex: Int32(value["sdpMLineIndex"] as? Int ?? 0), sdpMid: value["sdpMid"] as? String))
        case "room-closed", "participant-disconnected":
            let reason = message["reason"] as? String ?? "Звонок завершён"
            end(); error = reason
        case "error":
            let text = message["message"] as? String ?? "Не удалось подключиться"
            if message["fatal"] as? Bool == true || ["ROOM_NOT_FOUND", "ROOM_FULL", "AUTH_REQUIRED", "ROOM_EXISTS"].contains(message["code"] as? String ?? "") { end() }
            error = text
        default: break
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ object: Any?) -> T? {
        guard let object, JSONSerialization.isValidJSONObject(object), let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func ensure(_ id: String) -> MediaPeer? {
        guard id != selfID, UUID(uuidString: id) != nil, participants.contains(where: { $0.id == id }), let factory, let audio else { return nil }
        if let existing = peers[id] { return existing }
        do {
            let peer = try MediaPeer(id: id, localID: selfID, factory: factory, audio: audio, ice: ice, camera: localVideo)
            peers[id] = peer
            peer.sendSignal = { [weak self] in self?.socket.send($0) }
            peer.changed = { [weak self] in self?.refreshPhase() }
            peer.failed = { [weak self] in self?.error = $0 }
            peer.negotiate()
            return peer
        } catch { self.error = error.localizedDescription; return nil }
    }

    private func refreshPhase() {
        revision += 1
        if peers.isEmpty || peers.values.contains(where: { $0.state == .connected || $0.state == .completed }) {
            phase = .connected; applySpeaker()
        } else { phase = .connecting }
    }

    private func sendInvitations() {
        guard !ringMembers.isEmpty else { return }
        let members = ringMembers; ringMembers = []
        let room = roomID; let expected = generation
        ringTask?.cancel()
        ringTask = Task {
            for attempt in 0..<5 {
                guard expected == generation && active && !Task.isCancelled else { return }
                do { try await client.invite(roomID: room, userIDs: members); return }
                catch {
                    if attempt == 4 { self.error = "Приглашение не отправлено. Можно войти по коду комнаты." }
                    else { try? await Task.sleep(for: .seconds(1.5)) }
                }
            }
        }
    }

    func setMuted(_ value: Bool) {
        muted = value; audio?.isEnabled = !value
        socket.send(["type": "mute-changed", "muted": value])
    }
    func toggleSpeaker() { speaker.toggle(); applySpeaker() }
    func video(participantID: String, source: String = "camera") -> RTCVideoTrack? {
        _ = revision
        return participantID == selfID ? localVideo : peers[participantID]?.video(source: source)
    }
    func connectionState(_ id: String) -> String {
        guard id != selfID else { return muted ? "Микрофон выключен" : "Вы в звонке" }
        guard let peer = peers[id] else { return "Подключение…" }
        switch peer.state { case .connected, .completed: return "На связи"; case .failed, .disconnected: return "Переподключение…"; default: return "Подключение…" }
    }

    func toggleCamera() async {
        guard active, !cameraBusy, let factory else { return }
        cameraBusy = true
        defer { cameraBusy = false }
        if cameraOn { stopCamera(); return }
        cameraGeneration += 1
        let expected = cameraGeneration
        guard await AVCaptureDevice.requestAccess(for: .video) else { error = "Разрешите доступ к камере в настройках TRLKA."; return }
        guard active && expected == cameraGeneration else { return }
        let source = factory.videoSource()
        let capture = RTCCameraVideoCapturer(delegate: source)
        guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }) ?? RTCCameraVideoCapturer.captureDevices().first else { error = "Камера недоступна"; return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        guard let format = formats.min(by: { abs(Int(CMVideoFormatDescriptionGetDimensions($0.formatDescription).width) - 640) < abs(Int(CMVideoFormatDescriptionGetDimensions($1.formatDescription).width) - 640) }) else { error = "Формат камеры недоступен"; return }
        let fps = min(24, Int(format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 24))
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                capture.startCapture(with: device, format: format, fps: fps) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
            guard active && expected == cameraGeneration else { capture.stopCapture {}; return }
            cameraSource = source; capturer = capture; cameraDevice = device
            localVideo = factory.videoTrack(with: source, trackId: "camera-\(UUID().uuidString.lowercased())")
            cameraOn = true
            peers.values.forEach { $0.setCamera(localVideo) }; revision += 1
        } catch { self.error = error.localizedDescription }
    }
    private func stopCamera() {
        cameraGeneration += 1; cameraOn = false
        peers.values.forEach { $0.setCamera(nil) }
        capturer?.stopCapture {}; capturer = nil; cameraSource = nil; localVideo = nil; cameraDevice = nil; revision += 1
    }

    func end() {
        generation += 1
        ringTask?.cancel(); ringTask = nil
        socket.finish(["type": "leave-room"])
        peers.values.forEach { $0.close() }; peers.removeAll()
        stopCamera(); audio?.isEnabled = false; audio = nil; audioSource = nil; factory = nil
        participants = []; selfID = ""; roomID = ""; ringMembers = []; chatID = nil
        phase = .idle; muted = false; presented = false
        #if os(iOS)
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }; interruptionObserver = nil
        if let previousAudio {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previousAudio.0, mode: previousAudio.1, options: previousAudio.2)
        }
        previousAudio = nil
        #endif
    }

    private func configureAudio() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        previousAudio = (session.category, session.mode, session.categoryOptions)
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let began = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            Task { @MainActor in
                guard let self, self.active else { return }
                if began { self.setMuted(true); self.error = "Микрофон выключен из-за другого звонка. Включите его после завершения." }
                else { self.applySpeaker() }
            }
        }
        #endif
    }
    private func applySpeaker() {
        #if os(iOS)
        guard previousAudio != nil else { return }
        let session = AVAudioSession.sharedInstance()
        let external = session.currentRoute.outputs.contains { [.bluetoothA2DP, .bluetoothHFP, .headphones, .airPlay, .usbAudio].contains($0.portType) }
        if !external { try? session.overrideOutputAudioPort(speaker ? .speaker : .none) }
        #endif
    }
}
