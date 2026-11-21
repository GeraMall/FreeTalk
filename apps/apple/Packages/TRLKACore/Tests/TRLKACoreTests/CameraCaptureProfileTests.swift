import XCTest
@testable import TRLKACore

final class CameraCaptureProfileTests: XCTestCase {
    func testPrefers720pAt30WithoutSelectingAHigherCameraMode() {
        let result = CameraCaptureProfile.choose([
            .init(width: 640, height: 480, frameRates: [15...30]),
            .init(width: 1280, height: 720, frameRates: [15...30]),
            .init(width: 1920, height: 1080, frameRates: [30...60]),
            .init(width: 3840, height: 2160, frameRates: [24...60]),
        ])
        XCTAssertEqual(result?.index, 1)
        XCTAssertEqual(result?.fps, 30)
    }

    func testUsesActualSupportedRatesAndLowResolutionFallback() {
        let result = CameraCaptureProfile.choose([
            .init(width: 1280, height: 720, frameRates: [60...120]),
            .init(width: 640, height: 480, frameRates: [10...24]),
            .init(width: 1280, height: 720, frameRates: []),
        ])
        XCTAssertEqual(result?.index, 1)
        XCTAssertEqual(result?.fps, 24)
    }
}
