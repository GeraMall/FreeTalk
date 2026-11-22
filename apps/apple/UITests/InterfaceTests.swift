import XCTest

final class InterfaceTests: XCTestCase {
    func testRoomChatShowsSignalingHistoryAndReturnsToCall() {
        let app = launch("call")
        let open = app.buttons["call.chat"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.staticTexts["Сообщение из комнаты"].waitForExistence(timeout: 5))
        app.buttons["Закрыть чат"].tap()
        XCTAssertTrue(app.buttons["call.end"].waitForExistence(timeout: 5))
    }

    func testSharedTabletOpensFromACallAndReturnsToItsParticipants() {
        let app = launch("call")
        let open = app.buttons["call.tablet"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let close = app.webViews.buttons["Свернуть планшет"]
        XCTAssertTrue(close.waitForExistence(timeout: 12), "The bundled renderer must load inside WKWebView")
        XCTAssertTrue(app.webViews.buttons["Шахматы"].firstMatch.exists)
        close.tap()
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["call.microphone"].exists)
    }
    func testVideoTilesExpandSwapResizeAndReturnToAudioList() {
        let app = launch("call-video")
        let grid = app.descendants(matching: .any).matching(identifier: "call.video-grid").firstMatch
        XCTAssertTrue(grid.waitForExistence(timeout: 10))
        let own = app.descendants(matching: .any).matching(identifier: "call.participant.11111111-1111-4111-8111-111111111111").firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 5))
        XCTAssertEqual(own.value as? String, "Камера", "Self camera must not be treated as screen sharing")
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

    @MainActor
    func testScreenShareFillsBothOrientationsAndReturnsToEqualTilesWhenItEnds() async {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch("call-screen")
        let own = participant(app, "11111111-1111-4111-8111-111111111111")
        let peer = participant(app, "22222222-2222-4222-8222-222222222222")
        let guest = participant(app, "44444444-4444-4444-8444-444444444444")
        XCTAssertTrue(own.waitForExistence(timeout: 10))
        XCTAssertTrue(peer.waitForExistence(timeout: 5))
        XCTAssertTrue(guest.waitForExistence(timeout: 5))
        for tile in [peer, guest] {
            XCTAssertEqual(tile.frame.width, own.frame.width, accuracy: 2)
            XCTAssertEqual(tile.frame.height, own.frame.height, accuracy: 2)
        }
        XCTAssertEqual(guest.frame.midX, app.frame.midX, accuracy: 5)

        peer.tap()
        let close = app.buttons["call.close-presentation"]
        let portraitReady = await waitForCallLayout { close.isHittable && peer.frame.width >= app.frame.width - 5 }
        XCTAssertTrue(portraitReady)
        XCTAssertEqual(peer.value as? String, "Демонстрация экрана")
        XCTAssertGreaterThanOrEqual(peer.frame.width, app.frame.width - 5)
        XCTAssertTrue(app.buttons["call.chat"].isHittable)
        XCTAssertTrue(app.buttons["call.end"].isHittable)
        attachCallScreen("screen-share-portrait", app: app)

        XCUIDevice.shared.orientation = .landscapeLeft
        let landscapeReady = await waitForCallLayout {
            app.frame.width > app.frame.height && close.isHittable && peer.frame.width >= app.frame.width - 5
        }
        XCTAssertTrue(landscapeReady)
        XCTAssertTrue(close.isHittable)
        XCTAssertGreaterThanOrEqual(peer.frame.width, app.frame.width - 5)
        XCTAssertTrue(app.buttons["call.chat"].isHittable)
        XCTAssertTrue(app.buttons["call.microphone"].isHittable)
        attachCallScreen("screen-share-landscape", app: app)

        close.tap()
        let gridRestored = await waitForCallLayout { !close.exists && peer.isHittable }
        XCTAssertTrue(gridRestored)
        peer.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        app.buttons["call.more"].tap()
        let stop = app.buttons["call.stop-preview-screen"]
        XCTAssertTrue(app.scrollViews["call.options"].waitForExistence(timeout: 5))
        if !stop.isHittable { app.scrollViews["call.options"].swipeUp() }
        XCTAssertTrue(stop.isHittable)
        stop.tap()
        let shareEnded = await waitForCallLayout {
            !close.exists && peer.value as? String == "Без видео" && own.value as? String == "Камера"
        }
        XCTAssertTrue(shareEnded)
        XCTAssertEqual(own.value as? String, "Камера")
        XCTAssertEqual(peer.value as? String, "Без видео")
    }

    @MainActor
    private func waitForCallLayout(_ ready: () -> Bool) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(8)
        while clock.now < deadline {
            if ready() { return true }
            try? await Task.sleep(for: .milliseconds(120))
        }
        return ready()
    }

    private func participant(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "call.participant.\(id)").firstMatch
    }

    private func attachCallScreen(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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

    func testQRShortcutCanBeHiddenAndSettingsStillOpenScanner() {
        let app = launch("home")
        let shortcut = app.buttons["tab.qr"]
        let profile = app.buttons["app.profile"]
        let appearance = app.buttons["settings.appearance"]
        let toggle = app.switches["settings.qr-shortcut"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        if !shortcut.exists {
            profile.tap()
            appearance.tap()
            XCTAssertTrue(toggle.waitForExistence(timeout: 5))
            toggle.tap()
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(shortcut.waitForExistence(timeout: 10))
        XCTAssertEqual(shortcut.frame.midX, app.frame.midX, accuracy: 4)
        shortcut.tap()
        let close = app.buttons["qr.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        profile.tap()
        XCTAssertTrue(appearance.waitForExistence(timeout: 5))
        appearance.tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
        app.terminate()
        app.launch()
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        XCTAssertFalse(shortcut.exists)
        profile.tap()
        let settingsShortcut = app.buttons["settings.qr"]
        XCTAssertTrue(settingsShortcut.waitForExistence(timeout: 5))
        settingsShortcut.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        appearance.tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
    }

    func testAccountDeletionRequiresAPasswordAndCanBeCancelled() {
        let app = launch("home")
        let settings = app.buttons["app.profile"]
        let profile = app.buttons["settings.profile"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(profile.waitForExistence(timeout: 5))
        profile.tap()
        let delete = app.buttons["settings.delete-account"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        let review = app.buttons["delete-account.review"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertFalse(review.isEnabled)
        app.buttons["Отмена"].tap()
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
    }

    func testDirectChatProfileExposesBlockWithConfirmation() {
        let app = launch("conversation")
        let profile = app.buttons["chat.profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        profile.tap()
        let block = app.buttons["profile.block"]
        XCTAssertTrue(block.waitForExistence(timeout: 5))
        block.tap()
        let confirm = app.alerts.firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertTrue(confirm.buttons["Заблокировать"].exists)
        confirm.buttons["Отмена"].tap()
        XCTAssertTrue(block.waitForExistence(timeout: 5))
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
