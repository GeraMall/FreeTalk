import Foundation

/// Prefer wide HD at a supported frame rate. The camera sends one track to each peer,
/// so the handset does not spend its budget on multi-megapixel capture.
public enum CameraCaptureProfile {
    public struct Format: Sendable {
        let width: Int
        let height: Int
        let frameRates: [ClosedRange<Double>]

        public init(width: Int, height: Int, frameRates: [ClosedRange<Double>]) {
            self.width = width
            self.height = height
            self.frameRates = frameRates
        }
    }

    public static func choose(_ formats: [Format]) -> (index: Int, fps: Int)? {
        let candidates = formats.enumerated().compactMap { index, format -> (index: Int, fps: Int, score: Double)? in
            guard format.width > 0, format.height > 0, format.width <= 1920, format.height <= 1080,
                  let rate = (15...30).reversed().first(where: { fps in
                      format.frameRates.contains { $0.contains(Double(fps)) }
                  }) else { return nil }
            let width = Double(format.width)
            let height = Double(format.height)
            let scaleDistance = abs(log((width * height) / (1280 * 720)))
            let aspectDistance = abs(log(width / height / (16.0 / 9.0)))
            let overshoot = width > 1280 || height > 720 ? 0.7 : 0
            let score = scaleDistance + aspectDistance + overshoot + Double(30 - rate) * 0.12
            return (index, rate, score)
        }
        guard let best = candidates.min(by: { $0.score < $1.score }) else { return nil }
        return (best.index, best.fps)
    }
}
