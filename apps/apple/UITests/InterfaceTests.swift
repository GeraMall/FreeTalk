import XCTest

final class InterfaceTests: XCTestCase {
    func testVideoTilesExpandSwapResizeAndReturnToAudioList() {
        let app = launch("call-video")
        let grid = app.descendants(matching: .any).matching(identifier: "call.video-grid").firstMatch
        XCTAssertTrue(grid.waitForExistence(timeout: 10))
        let peer = app.descendants(matching: .any).matching(identifier: "call.participant.22222222-2222-4222-8222-222222222222").firstMatch
        XCTAssertTrue(peer.waitForExistence(timeout: 5)); peer.tap()
        let back = app.buttons["call.return-grid"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        let preview = app.descendants(matching: .any).matching(identifier: "call.self-preview").firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        preview.tap()
        XCTAssertTrue(back.exists)
        let before = preview.frame
        preview.pinch(withScale: 1.3, velocity: 1)
        XCTAssertGreaterThan(preview.frame.width, before.width)
        let origin = preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        origin.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)))
        XCTAssertTrue(app.buttons["call.end"].isHittable)
        back.tap()
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        app.buttons["call.camera"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "call.audio-list").firstMatch.waitForExistence(timeout: 5))
    }
    private func launch(_ mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview", mode, "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launch()
        return app
    }

    func testChatComposerKeyboardAndBackNavigation() {
        let app = launch("home")
        let brand = app.staticTexts["app.brand"]
        let profile = app.buttons["app.profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        XCTAssertLessThan(brand.frame.midX, profile.frame.midX)
        app.buttons["tab.chats"].tap()
        let row = app.descendants(matching: .any).matching(identifier: "chat.row.33333333-3333-4333-8333-333333333333").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        row.tap()
        let field = app.descendants(matching: .any).matching(identifier: "chat.composer").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8))
        XCTAssertTrue(field.isHittable, "Composer must remain above bottom navigation")
        field.tap()
        field.typeText("Test message")
        XCTAssertTrue(app.buttons["chat.send"].isEnabled)
        app.buttons["chat.back"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 8), "Back must restore the chat list")
        app.buttons["app.profile"].tap()
        XCTAssertTrue(app.buttons["settings.done"].waitForExistence(timeout: 5), "One tap must open settings")
        app.buttons["settings.done"].tap()
        XCTAssertTrue(app.buttons["tab.home"].isHittable)
        row.tap()
        let restored = app.descendants(matching: .any).matching(identifier: "chat.composer").firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 5))
        XCTAssertTrue((restored.value as? String)?.contains("Test message") == true, "Draft must survive back navigation")
    }

    func testMinimizedCallKeepsChatUsableAndCanReturnAndEnd() {
        let app = launch("call")
        XCTAssertTrue(app.buttons["call.microphone"].waitForExistence(timeout: 10))
        app.buttons["call.minimize"].tap()
        XCTAssertTrue(app.buttons["call.return"].waitForExistence(timeout: 5))
        app.buttons["tab.chats"].tap()
        let row = app.descendants(matching: .any).matching(identifier: "chat.row.33333333-3333-4333-8333-333333333333").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8)); row.tap()
        XCTAssertTrue(app.buttons["call.return"].isHittable)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "chat.composer").firstMatch.isHittable)
        app.buttons["call.return"].tap()
        XCTAssertTrue(app.buttons["call.end"].waitForExistence(timeout: 5))
        app.buttons["call.end"].tap()
        XCTAssertTrue(app.buttons["chat.back"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["call.return"].exists)
    }
}
