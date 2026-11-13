import Foundation
import WebRTC

/// Serializes SDP operations per peer, including glare rollback and queued ICE.
@MainActor
final class MediaPeer: NSObject {
    enum Grade: Int { case unknown, good, fair, poor }
    var grade: Grade = .unknown
    var remoteLevel: Double = 0
    var localLevel: Double = 0
    let id: String
    let localID: String
    let connection: RTCPeerConnection
    private let factory: RTCPeerConnectionFactory
    private var ice: [RTCIceServer]
    private let passive: Bool
    private var screenPeer: MediaPeer?
    private weak var screenChannel: RTCDataChannel?
    var sendSignal: (([String: Any]) -> Void)?
    var changed: (() -> Void)?
    var failed: ((String) -> Void)?
    var state: RTCIceConnectionState = .new
    var tracks: [String: RTCVideoTrack] = [:]
    var sources: [String: Any]?
    var localCamera: RTCVideoTrack?
    private var cameraSender: RTCRtpSender?
    private var channels: [RTCDataChannel] = []
    private var pendingICE: [RTCIceCandidate] = []
    private var operation: Task<Void, Never>?
    private var pendingNegotiation = false
    private var ignoreOffer = false
    private var closed = false
    private var outputMuted = false

    func setOutputMuted(_ value: Bool) {
        outputMuted = value
        for receiver in connection.receivers {
            (receiver.track as? RTCAudioTrack)?.isEnabled = !value
        }
        screenPeer?.setOutputMuted(value)
    }

    func sampleStatistics() {
        guard !closed else { return }
        connection.statistics { [weak self] report in
            var rtt: Double?
            var loss = 0.0
            var remote = 0.0
            var local = 0.0
            for sample in report.statistics.values {
                let values = sample.values
                if sample.type == "candidate-pair", values["state"] as? String == "succeeded",
                   let number = values["currentRoundTripTime"] as? NSNumber { rtt = max(rtt ?? 0, number.doubleValue) }
                if sample.type == "remote-inbound-rtp", let number = values["fractionLost"] as? NSNumber { loss = max(loss, number.doubleValue) }
                let audio = values["kind"] as? String == "audio" || values["mediaType"] as? String == "audio"
                if audio, let number = values["audioLevel"] as? NSNumber {
                    if sample.type == "inbound-rtp" { remote = max(remote, number.doubleValue) }
                    if sample.type == "media-source" { local = max(local, number.doubleValue) }
                }
            }
            let measuredRTT = rtt; let measuredLoss = loss; let measuredRemote = remote; let measuredLocal = local
            Task { @MainActor in
                guard let self, !self.closed else { return }
                let grade: Grade
                if self.state == .failed || self.state == .disconnected { grade = .poor }
                else if let measuredRTT { grade = measuredRTT > 1 || measuredLoss > 0.15 ? .poor : measuredRTT > 0.3 || measuredLoss > 0.05 ? .fair : .good }
                else { grade = .unknown }
                if grade != self.grade || abs(self.remoteLevel - measuredRemote) > 0.01 || abs(self.localLevel - measuredLocal) > 0.01 {
                    self.grade = grade; self.remoteLevel = measuredRemote; self.localLevel = measuredLocal; self.changed?()
                }
            }
        }
    }

    init(id: String, localID: String, factory: RTCPeerConnectionFactory, audio: RTCAudioTrack?,
         ice: [RTCIceServer], camera: RTCVideoTrack?, passive: Bool = false) throws {
        self.id = id; self.localID = localID
        self.factory = factory; self.ice = ice; self.passive = passive
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.iceServers = ice
        configuration.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
        guard let pc = factory.peerConnection(with: configuration, constraints: constraints, delegate: nil) else { throw URLError(.cannotConnectToHost) }
        connection = pc
        super.init()
        connection.delegate = self
        if let audio { connection.add(audio, streamIds: ["audio"]) }
        if let camera { setCamera(camera) }
        if !passive, localID < id, let channel = connection.dataChannel(forLabel: "freetalk-video-state-v1", configuration: RTCDataChannelConfiguration()) {
            attach(channel)
        }
    }

    func setCamera(_ track: RTCVideoTrack?) {
        if let track {
            if let cameraSender { cameraSender.track = track }
            else { cameraSender = connection.add(track, streamIds: ["camera"]) }
        } else if let cameraSender { connection.removeTrack(cameraSender); self.cameraSender = nil }
        localCamera = track
        publishVideo()
        negotiate()
    }

    func updateICE(_ servers: [RTCIceServer]) {
        // The local TURN list can arrive after gathering has already started.
        // Ignore duplicate refreshes and keep established transports uninterrupted.
        guard !closed, !servers.isEmpty,
              !ice.elementsEqual(servers, by: { $0.urlStrings == $1.urlStrings && $0.username == $1.username && $0.credential == $1.credential }) else { return }
        ice = servers
        screenPeer?.updateICE(servers)
        let config = connection.configuration
        config.iceServers = servers
        if connection.setConfiguration(config), state != .connected && state != .completed {
            if passive { sendSignal?(["type": "restart"]) }
            else { connection.restartIce() }
        }
    }

    func negotiate() {
        guard !passive else { return }
        pendingNegotiation = true
        enqueue { [weak self] in
            guard let self, !closed, pendingNegotiation, connection.signalingState == .stable else { return }
            pendingNegotiation = false
            try await createDescription(offer: true)
        }
    }

    private func enqueue(_ work: @escaping @MainActor () async throws -> Void) {
        let previous = operation
        operation = Task { [weak self] in
            await previous?.value
            guard let self, !closed, !Task.isCancelled else { return }
            do { try await work() } catch { if !closed { failed?(error.localizedDescription) } }
        }
    }

    func description(type: String, sdp: String) {
        enqueue { [weak self] in
            guard let self, !closed else { return }
            let offer = type == "offer"
            if !offer && connection.signalingState != .haveLocalOffer { return }
            let collision = offer && connection.signalingState != .stable
            ignoreOffer = collision && localID < id
            if ignoreOffer { return }
            if collision { try await setLocal(RTCSessionDescription(type: .rollback, sdp: "")) }
            try await setRemote(RTCSessionDescription(type: offer ? .offer : .answer, sdp: sdp))
            for candidate in pendingICE { connection.add(candidate) { _ in } }
            pendingICE.removeAll()
            if offer { try await createDescription(offer: false) }
            if pendingNegotiation { negotiate() }
        }
    }

    func candidate(_ candidate: RTCIceCandidate) {
        enqueue { [weak self] in
            guard let self, !closed, !ignoreOffer else { return }
            if connection.remoteDescription == nil {
                if pendingICE.count < 128 { pendingICE.append(candidate) }
            } else { connection.add(candidate) { _ in } }
        }
    }

    private func createDescription(offer: Bool) async throws {
        let description: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            let callback: (RTCSessionDescription?, Error?) -> Void = { sdp, error in
                if let error { continuation.resume(throwing: error) }
                else if let sdp { continuation.resume(returning: sdp) }
                else { continuation.resume(throwing: URLError(.cannotParseResponse)) }
            }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            if offer { connection.offer(for: constraints, completionHandler: callback) }
            else { connection.answer(for: constraints, completionHandler: callback) }
        }
        guard !closed else { return }
        try await setLocal(description)
        guard !closed else { return }
        sendSignal?(["type": offer ? "offer" : "answer", "to": id,
                     "description": ["type": offer ? "offer" : "answer", "sdp": description.sdp]])
        publishVideo()
    }

    private func setLocal(_ description: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    private func setRemote(_ description: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func close() {
        screenPeer?.close(); screenPeer = nil
        closed = true; operation?.cancel(); operation = nil
        channels.forEach { $0.delegate = nil; $0.close() }; channels.removeAll()
        connection.delegate = nil; connection.close(); tracks.removeAll()
    }

    private func attach(_ channel: RTCDataChannel) {
        guard ["freetalk-video-state-v1", "trlka-native-screen-v1"].contains(channel.label) else { channel.close(); return }
        channels.removeAll { $0.readyState == .closed }
        guard channels.count < 8 else { channel.close(); return }
        channels.append(channel); channel.delegate = self
        if channel.label == "trlka-native-screen-v1" {
            screenPeer?.close()
            screenPeer = nil
            screenChannel = channel
        }
        if channel.readyState == .open { opened(channel) }
    }

    private func createScreenPeer(on channel: RTCDataChannel) {
        screenPeer?.close()
        screenPeer = try? MediaPeer(id: id, localID: localID, factory: factory, audio: nil, ice: ice, camera: nil, passive: true)
        screenPeer?.setOutputMuted(outputMuted)
        screenPeer?.changed = { [weak self] in self?.changed?() }
        screenPeer?.sendSignal = { [weak self, weak channel] message in
            guard let self, let channel, channel.readyState == .open else { return }
            if message["type"] as? String == "ice-candidate", let candidate = message["candidate"] {
                self.sendData(["kind": "ice", "candidate": candidate], channel: channel)
            } else if let description = message["description"] as? [String: Any], let sdp = description["sdp"] {
                self.sendData(["kind": "answer", "sdp": sdp], channel: channel)
            } else if message["type"] as? String == "restart" { self.sendData(["kind": "restart"], channel: channel) }
        }
    }

    private func opened(_ channel: RTCDataChannel) {
        if channel.label == "trlka-native-screen-v1" { sendData(["kind": "ready"], channel: channel) }
        else { sendData(["version": 2, "request": "video-state"], channel: channel); publishVideo() }
    }
    private func sendData(_ json: [String: Any], channel: RTCDataChannel) {
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        _ = channel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }
    private func publishVideo() {
        let mid = connection.transceivers.first(where: { $0.sender.senderId == cameraSender?.senderId })?.mid
        let message: [String: Any] = ["version": 2, "sources": [
            "camera": ["active": localCamera != nil, "trackId": localCamera?.trackId as Any? ?? NSNull(), "mid": mid as Any? ?? NSNull()],
            "screen": ["active": false, "trackId": NSNull(), "mid": NSNull()]
        ]]
        for channel in channels where channel.readyState == .open && channel.label == "freetalk-video-state-v1" { sendData(message, channel: channel) }
    }
    func video(source: String) -> RTCVideoTrack? {
        if source == "screen", let native = screenPeer?.tracks.values.first { return native }
        if let sources {
            guard let value = sources[source] as? [String: Any], value["active"] as? Bool == true,
                  let trackID = value["trackId"] as? String else { return nil }
            return tracks[trackID]
        }
        return source == "camera" ? tracks.values.first : nil
    }
}

extension MediaPeer: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) { Task { @MainActor [weak self] in self?.negotiate() } }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        Task { @MainActor [weak self] in
            guard let self, !closed else { return }
            state = newState
            if newState == .failed {
                if passive { sendSignal?(["type": "restart"]) } else { connection.restartIce() }
            }
            if newState == .connected || newState == .completed { publishVideo() }
            changed?()
        }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor [weak self] in
            guard let self, !closed else { return }
            var value: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": Int(candidate.sdpMLineIndex)]
            if let mid = candidate.sdpMid { value["sdpMid"] = mid }
            sendSignal?(["type": "ice-candidate", "to": id, "candidate": value])
        }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didOpen channel: RTCDataChannel) {
        Task { @MainActor [weak self] in guard let self, !closed else { return }; attach(channel) }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        Task { @MainActor [weak self] in
            guard let self, !closed else { return }
            if let audio = rtpReceiver.track as? RTCAudioTrack { audio.isEnabled = !outputMuted }
            guard let track = rtpReceiver.track as? RTCVideoTrack else { return }
            tracks[track.trackId] = track; changed?()
        }
    }
    nonisolated func dataChannelDidChangeState(_ channel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self, !closed, channel.readyState == .open else { return }
            opened(channel)
        }
    }
    nonisolated func dataChannel(_ channel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary, buffer.data.count < (channel.label == "trlka-native-screen-v1" ? 128000 : 16384),
              let json = try? JSONSerialization.jsonObject(with: buffer.data) as? [String: Any] else { return }
        Task { @MainActor [weak self] in
            guard let self, !closed else { return }
            if channel.label == "trlka-native-screen-v1" {
                guard channel === screenChannel else { return }
                if json["kind"] as? String == "stop" { screenPeer?.close(); screenPeer = nil; changed?() }
                else if json["kind"] as? String == "offer", let sdp = json["sdp"] as? String {
                    if screenPeer == nil { createScreenPeer(on: channel) }
                    screenPeer?.description(type: "offer", sdp: sdp)
                }
                else if json["kind"] as? String == "ice", let value = json["candidate"] as? [String: Any], let sdp = value["candidate"] as? String {
                    if screenPeer == nil { createScreenPeer(on: channel) }
                    screenPeer?.candidate(RTCIceCandidate(sdp: sdp, sdpMLineIndex: Int32(value["sdpMLineIndex"] as? Int ?? 0), sdpMid: value["sdpMid"] as? String))
                }
                return
            }
            if json["request"] as? String == "video-state" { publishVideo() }
            if let value = json["sources"] as? [String: Any] { sources = value; changed?() }
        }
    }
}
