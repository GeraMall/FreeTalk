import XCTest
@testable import TRLKACore

final class CallTileLayoutTests: XCTestCase {
    func testPhoneFitsOneToEightSquareParticipantsWithoutHorizontalOverflow() {
        for width in [288.0, 358.0, 398.0] {
            for count in 1...8 {
                let layout = CallTileLayout(width: width, height: 560, count: count)
                XCTAssertLessThanOrEqual(layout.side * Double(layout.columns) + 10 * Double(layout.columns - 1), width + 1)
                XCTAssertFalse(layout.needsScroll)
                XCTAssertGreaterThanOrEqual(layout.side, 112)
            }
        }
    }
    func testShortLandscapeKeepsUsableTilesAndScrollsInsteadOfCoveringControls() {
        let layout = CallTileLayout(width: 700, height: 130, count: 8)
        XCTAssertTrue(layout.needsScroll)
        XCTAssertGreaterThanOrEqual(layout.side, 112)
        XCTAssertEqual(layout.columns, 3)
    }
    func testTabletUsesAvailableWidthAndHandlesVerySmallViewports() {
        XCTAssertEqual(CallTileLayout(width: 960, height: 600, count: 8).columns, 4)
        XCTAssertFalse(CallTileLayout(width: 960, height: 600, count: 8).needsScroll)
        let tiny = CallTileLayout(width: 180, height: 70, count: 2)
        XCTAssertTrue(tiny.needsScroll)
        XCTAssertLessThanOrEqual(tiny.side * 2 + 10, 180)
    }
}
