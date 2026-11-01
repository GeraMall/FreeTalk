import Foundation
import WebRTC

/// Serializes SDP operations per peer, including glare rollback and queued ICE.
@MainActor
final class MediaPeer: NSObject {
    let id: String
    let localID: String
    let connection: RTCPeerConnection
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

    init(id: String, localID: String, factory: RTCPeerConnectionFactory, audio: RTCAudioTrack,
         ice: [RTCIceServer], camera: RTCVideoTrack?) throws {
        self.id = id; self.localID = localID
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.iceServers = ice
        configuration.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: ["DtlsSrtpKeyAgreement": "true"])
        guard let pc = factory.peerConnection(with: configuration, constraints: constraints, delegate: nil) else { throw URLError(.cannotConnectToHost) }
        connection = pc
        super.init()
        connection.delegate = self
        connection.add(audio, streamIds: ["audio"])
        if let camera { setCamera(camera) }
        if localID < id, let channel = connection.dataChannel(forLabel: "freetalk-video-state-v1", configuration: RTCDataChannelConfiguration()) {
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
        let config = connection.configuration
        config.iceServers = servers
        connection.setConfiguration(config)
    }

    func negotiate() {
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
        closed = true; operation?.cancel(); operation = nil
        channels.forEach { $0.delegate = nil; $0.close() }; channels.removeAll()
        connection.delegate = nil; connection.close(); tracks.removeAll()
    }

    private func attach(_ channel: RTCDataChannel) {
        channels.append(channel); channel.delegate = self
        if channel.readyState == .open { publishVideo() }
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
        for channel in channels where channel.readyState == .open { sendData(message, channel: channel) }
    }
    func video(source: String) -> RTCVideoTrack? {
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
            if newState == .failed { connection.restartIce() }
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
            guard let self, !closed, let track = rtpReceiver.track as? RTCVideoTrack else { return }
            tracks[track.trackId] = track; changed?()
        }
    }
    nonisolated func dataChannelDidChangeState(_ channel: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self, !closed, channel.readyState == .open else { return }
            sendData(["version": 2, "request": "video-state"], channel: channel); publishVideo()
        }
    }
    nonisolated func dataChannel(_ channel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary, buffer.data.count < 16384,
              let json = try? JSONSerialization.jsonObject(with: buffer.data) as? [String: Any] else { return }
        Task { @MainActor [weak self] in
            guard let self, !closed else { return }
            if json["request"] as? String == "video-state" { publishVideo() }
            if let value = json["sources"] as? [String: Any] { sources = value; changed?() }
        }
    }
}
