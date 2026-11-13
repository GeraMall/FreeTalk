#if os(iOS)
import ReplayKit
import WebRTC
import ImageIO

/// Captures TRLKA's window only. Call audio stays on its existing WebRTC track.
@MainActor final class InAppScreenShare: NSObject, RPScreenRecorderDelegate {
    private enum Phase { case idle, starting, running, stopping, finished }
    private let recorder = RPScreenRecorder.shared()
    private var phase = Phase.idle
    private var stopRequested = false
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    let track: RTCVideoTrack
    var started: (() -> Void)?
    var ended: ((Error?) -> Void)?

    init(factory: RTCPeerConnectionFactory) {
        let source = factory.videoSource(forScreenCast: true)
        self.source = source
        self.capturer = RTCVideoCapturer(delegate: source)
        self.track = factory.videoTrack(with: source, trackId: "screen-\(UUID().uuidString.lowercased())")
        super.init()
    }

    func start() {
        guard phase == .idle else { return }
        guard recorder.isAvailable, !recorder.isRecording else {
            finish(NSError(domain: "TRLKA.ScreenShare", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Сейчас iOS не может начать показ экрана TRLKA."
            ]))
            return
        }
        phase = .starting
        recorder.delegate = self
        recorder.isMicrophoneEnabled = false
        recorder.isCameraEnabled = false
        let frames = Self.frameHandler(source: source, capturer: capturer) { [weak self] error in
            Task { @MainActor in self?.failed(error) }
        }
        recorder.startCapture(handler: frames, completionHandler: { [weak self] error in
            Task { @MainActor in
                guard let self, phase == .starting else { return }
                if let error { finish(error); return }
                phase = .running
                if stopRequested { stop() } else { started?() }
            }
        })
    }

    /// The samples are owned by ReplayKit. Feed them to WebRTC synchronously on its capture queue.
    private nonisolated static func frameHandler(source: RTCVideoSource, capturer: RTCVideoCapturer,
                                                  onError: @escaping @Sendable (Error) -> Void)
        -> (CMSampleBuffer, RPSampleBufferType, Error?) -> Void {
        { sample, kind, error in
            if let error { onError(error); return }
            guard kind == .video, CMSampleBufferDataIsReady(sample), let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
            let orientation = (CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value
            let rotation: RTCVideoRotation
            switch orientation.flatMap(CGImagePropertyOrientation.init(rawValue:)) {
            case .right, .rightMirrored: rotation = ._90
            case .down, .downMirrored: rotation = ._180
            case .left, .leftMirrored: rotation = ._270
            default: rotation = ._0
            }
            let timestamp = CMSampleBufferGetPresentationTimeStamp(sample)
            guard timestamp.isNumeric else { return }
            let frame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixels), rotation: rotation,
                                      timeStampNs: CMTimeConvertScale(timestamp, timescale: 1_000_000_000, method: .default).value)
            source.capturer(capturer, didCapture: frame)
        }
    }

    private func failed(_ error: Error) {
        guard phase == .running || phase == .starting else { return }
        // If the capture is still active, release it before accepting another start.
        if recorder.isRecording { stop(reporting: error) } else { finish(error) }
    }

    func stop() {
        stopRequested = true
        track.isEnabled = false
        if phase == .running { stop(reporting: nil) }
    }

    private func stop(reporting error: Error?) {
        phase = .stopping
        track.isEnabled = false
        recorder.stopCapture { [weak self] stopError in
            Task { @MainActor in self?.finish(error ?? stopError) }
        }
    }

    nonisolated func screenRecorder(_ screenRecorder: RPScreenRecorder,
                                    didStopRecordingWith previewViewController: RPPreviewViewController?, error: Error?) {
        Task { @MainActor [weak self] in self?.finish(error) }
    }

    private func finish(_ error: Error?) {
        guard phase != .finished else { return }
        phase = .finished
        track.isEnabled = false
        if recorder.delegate === self { recorder.delegate = nil }
        ended?(stopRequested ? nil : error)
    }
}
#endif
