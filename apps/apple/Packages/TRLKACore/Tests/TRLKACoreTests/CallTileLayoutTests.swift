import XCTest
@testable import TRLKACore

final class CallTileLayoutTests: XCTestCase {
    func testPhoneAndTabletDivideVideoAreaEquallyWithoutOverlap() {
        for width in [288.0, 358, 800, 960] {
            for count in 1...8 {
                let layout = CallTileLayout(width: width, height: 560, count: count)
                XCTAssertEqual(layout.frames.count, count)
                let area = layout.frames[0].width * layout.frames[0].height
                for (index, frame) in layout.frames.enumerated() {
                    XCTAssertEqual(frame.width * frame.height, area, accuracy: 0.01)
                    XCTAssertGreaterThanOrEqual(frame.x, 0)
                    XCTAssertGreaterThanOrEqual(frame.y, 0)
                    XCTAssertLessThanOrEqual(frame.x + frame.width, width + 1)
                    XCTAssertLessThanOrEqual(frame.y + frame.height, layout.canvasHeight + 1)
                    for other in layout.frames.dropFirst(index + 1) {
                        let overlaps = frame.x < other.x + other.width - 1 && other.x < frame.x + frame.width - 1 && frame.y < other.y + other.height - 1 && other.y < frame.y + frame.height - 1
                        XCTAssertFalse(overlaps)
                    }
                }
            }
        }
    }
    func testShortLandscapeKeepsUsableTilesAndScrollsInsteadOfCoveringControls() {
        let layout = CallTileLayout(width: 700, height: 130, count: 8)
        XCTAssertTrue(layout.needsScroll)
        XCTAssertTrue(layout.frames.allSatisfy { min($0.width, $0.height) >= 90 })
    }
    func testTwoPeopleShareTheAreaFiftyFifty() {
        let layout = CallTileLayout(width: 358, height: 550, count: 2)
        XCTAssertEqual(layout.frames[0].width, 358)
        XCTAssertEqual(layout.frames[0].height, 270)
        XCTAssertEqual(layout.frames[1].height, 270)
    }
}
