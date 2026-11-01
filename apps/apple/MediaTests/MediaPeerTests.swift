import XCTest
import WebRTC
import CoreVideo
@testable import TRLKAMedia

private final class FrameProbe: NSObject, RTCVideoRenderer {
    private let received: XCTestExpectation
    private let lock = NSLock()
    private var finished = false
    init(_ received: XCTestExpectation) { self.received = received }
    func setSize(_ size: CGSize) {}
    func renderFrame(_ frame: RTCVideoFrame?) {
        guard frame != nil else { return }
        lock.lock(); defer { lock.unlock() }
        if !finished { finished = true; received.fulfill() }
    }
}

final class MediaPeerTests: XCTestCase {
    @MainActor
    func testNativePeersHandleGlareAndReceiveVideoAfterCameraRestart() async throws {
        RTCInitializeSSL()
        let factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
        let first = try MediaPeer(id: "bbbb", localID: "aaaa", factory: factory, audio: nil, ice: [], camera: nil)
        let second = try MediaPeer(id: "aaaa", localID: "bbbb", factory: factory, audio: nil, ice: [], camera: nil)
        defer { first.close(); second.close() }
        func deliver(_ message: [String: Any], to peer: MediaPeer) {
            if let description = message["description"] as? [String: Any], let type = message["type"] as? String, let sdp = description["sdp"] as? String {
                peer.description(type: type, sdp: sdp)
            } else if let value = message["candidate"] as? [String: Any], let sdp = value["candidate"] as? String {
                peer.candidate(RTCIceCandidate(sdp: sdp, sdpMLineIndex: Int32(value["sdpMLineIndex"] as? Int ?? 0), sdpMid: value["sdpMid"] as? String))
            }
        }
        first.sendSignal = { deliver($0, to: second) }
        second.sendSignal = { deliver($0, to: first) }
        first.failed = { XCTFail("First peer: \($0)") }
        second.failed = { XCTFail("Second peer: \($0)") }
        let connected = expectation(description: "Native peers connected with simultaneous offers")
        var fulfilled = false
        let check = {
            let states: [RTCIceConnectionState] = [.connected, .completed]
            if !fulfilled && states.contains(first.state) && states.contains(second.state) { fulfilled = true; connected.fulfill() }
        }
        first.changed = check; second.changed = check
        first.negotiate(); second.negotiate()
        await fulfillment(of: [connected], timeout: 25)

        // Real H264/VP8 encode/decode with synthetic frames; no microphone/camera access.
        for index in 0..<2 {
            let received = expectation(description: "Video frame received, camera run \(index)")
            let probe = FrameProbe(received)
            let source = factory.videoSource()
            let capture = RTCVideoCapturer(delegate: source)
            let track = factory.videoTrack(with: source, trackId: "camera-\(index)")
            var attached = false
            second.changed = {
                if !attached, let remote = second.tracks.values.first(where: { $0.trackId == track.trackId }) {
                    remote.add(probe); attached = true
                }
            }
            first.setCamera(track)
            let sending = Task { @MainActor in
                for _ in 0..<220 {
                    if Task.isCancelled { return }
                    var buffer: CVPixelBuffer?
                    let result = CVPixelBufferCreate(kCFAllocatorDefault, 320, 240, kCVPixelFormatType_32BGRA,
                        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
                    if result == kCVReturnSuccess, let buffer {
                        CVPixelBufferLockBaseAddress(buffer, [])
                        if let address = CVPixelBufferGetBaseAddress(buffer) { memset(address, 100, CVPixelBufferGetBytesPerRow(buffer) * CVPixelBufferGetHeight(buffer)) }
                        CVPixelBufferUnlockBaseAddress(buffer, [])
                        let frame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: buffer), rotation: ._0,
                            timeStampNs: Int64(DispatchTime.now().uptimeNanoseconds))
                        source.capturer(capture, didCapture: frame)
                    }
                    try? await Task.sleep(for: .milliseconds(50))
                }
            }
            await fulfillment(of: [received], timeout: 20)
            sending.cancel()
            second.tracks.values.forEach { $0.remove(probe) }
            first.setCamera(nil)
            try await Task.sleep(for: .milliseconds(500))
        }
    }
}
