import XCTest
@testable import TRLKACore

private final class MemoryVault: SessionVault, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?
    init(_ token: String? = nil) { self.token = token }
    func read() -> String? { lock.lock(); defer { lock.unlock() }; return token }
    func write(_ token: String) { lock.lock(); defer { lock.unlock() }; self.token = token }
    func clear() { lock.lock(); defer { lock.unlock() }; token = nil }
}

private final class StubProtocol: URLProtocol, @unchecked Sendable {
    static var handle: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handle!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class AccountClientTests: XCTestCase {
    private let sessionJSON = #"{"accessToken":"access-new","refreshToken":"refresh-new","accessExpiresAt":"2026-11-02T00:00:00Z","refreshExpiresAt":"2026-12-01T00:00:00Z"}"#
    private let userJSON = #"{"id":"u1","username":"german","displayName":"Очень длинное имя пользователя","avatarUrl":null,"bio":null}"#

    private func client(vault: MemoryVault) throws -> AccountClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return try AccountClient(transport: URLSession(configuration: configuration), vault: vault)
    }

    override func tearDown() { StubProtocol.handle = nil; super.tearDown() }

    func testRegistrationKeepsOptionalNameAndConsentVersion() throws {
        let input = Registration(email: " A@B.EXAMPLE ", username: " Alice ", displayName: " ",
                                 password: "test123456", birthDate: "2001-12-30", legalVersion: "v2",
                                 acceptedTerms: true, acceptedPrivacy: true)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertEqual(body["email"] as? String, "a@b.example")
        XCTAssertEqual(body["username"] as? String, "alice")
        XCTAssertNil(body["displayName"])
        XCTAssertEqual(body["legalVersion"] as? String, "v2")
        XCTAssertEqual(body["acceptedTerms"] as? Bool, true)
        XCTAssertEqual(body["acceptedPrivacy"] as? Bool, true)
        XCTAssertTrue(Registration.validPassword("пароль123456"))
        XCTAssertFalse(Registration.validPassword("1234567890"))
    }

    func testVerificationCanRetryAfterExpiredCode() async throws {
        let vault = MemoryVault()
        let api = try client(vault: vault)
        StubProtocol.handle = { _ in (400, #"{"code":"CODE_EXPIRED"}"#) }
        do { _ = try await api.verifyEmail(email: "a@example.com", code: "000000"); XCTFail("Expired code accepted") }
        catch { XCTAssertNil(vault.read()) }
        StubProtocol.handle = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/auth/verify-email")
            return (200, "{\"user\":\(self.userJSON),\"session\":\(self.sessionJSON)}")
        }
        let user = try await api.verifyEmail(email: "a@example.com", code: "123456")
        XCTAssertEqual(user.id, "u1")
        XCTAssertEqual(vault.read(), "refresh-new")
    }

    func testRejectsInsecureOrCredentialBearingEndpoint() {
        for address in ["http://trlka.com/api", "https://user:password@trlka.com/api", "https://trlka.com/api?override=1"] {
            XCTAssertThrowsError(try AccountClient(baseURL: URL(string: address)!))
        }
    }

    func testLoginStoresRefreshTokenAndUsesAPIPath() async throws {
        let vault = MemoryVault()
        StubProtocol.handle = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/auth/login")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertEqual(request.httpMethod, "POST")
            return (200, "{\"user\":\(self.userJSON),\"session\":\(self.sessionJSON)}")
        }
        let user = try await client(vault: vault).login(login: "@german", password: "test-only")
        XCTAssertEqual(user.username, "german")
        XCTAssertEqual(vault.read(), "refresh-new")
    }

    func testOfflineRestoreRetainsRefreshToken() async throws {
        let vault = MemoryVault("saved-token")
        StubProtocol.handle = { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await client(vault: vault).restore(); XCTFail("Expected offline error") }
        catch { XCTAssertEqual(vault.read(), "saved-token") }
    }

    func testExpiredSessionClearsVault() async throws {
        let vault = MemoryVault("expired-token")
        StubProtocol.handle = { _ in (401, #"{"code":"INVALID_SESSION"}"#) }
        let result = try await client(vault: vault).restore()
        XCTAssertNil(result)
        XCTAssertNil(vault.read())
    }

    func testServerOutageRetainsSessionAndShowsSafeError() async throws {
        let vault = MemoryVault("saved-token")
        StubProtocol.handle = { _ in (503, "private upstream error") }
        do { _ = try await client(vault: vault).restore(); XCTFail("Expected 503") }
        catch let error as APIError {
            XCTAssertEqual(error.status, 503)
            XCTAssertFalse(error.message.contains("private"))
            XCTAssertEqual(vault.read(), "saved-token")
        }
    }

    func testConcurrentRequestsShareRefreshAndUseNewAccessToken() async throws {
        let vault = MemoryVault("saved-token")
        let lock = NSLock()
        var refreshes = 0
        StubProtocol.handle = { request in
            if request.url!.path.hasSuffix("/refresh") {
                lock.lock(); refreshes += 1; lock.unlock()
                Thread.sleep(forTimeInterval: 0.1)
                return (200, "{\"session\":\(self.sessionJSON)}")
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-new")
            return (200, #"{"chats":[]}"#)
        }
        let api = try client(vault: vault)
        async let first = api.chats()
        async let second = api.chats()
        _ = try await (first, second)
        XCTAssertEqual(refreshes, 1)
    }

    func testLogoutDoesNotRestoreTokensWhenServerIsOffline() async throws {
        let vault = MemoryVault("saved-token")
        StubProtocol.handle = { _ in throw URLError(.notConnectedToInternet) }
        try await client(vault: vault).logout()
        XCTAssertNil(vault.read())
    }

    func testLogoutDuringRefreshCannotResurrectSession() async throws {
        let vault = MemoryVault("saved-token")
        let started = expectation(description: "Refresh started")
        StubProtocol.handle = { _ in
            started.fulfill()
            Thread.sleep(forTimeInterval: 0.15)
            return (200, "{\"session\":\(self.sessionJSON)}")
        }
        let api = try client(vault: vault)
        let pending = Task { try await api.chats() }
        await fulfillment(of: [started], timeout: 2)
        try await api.logout()
        do { _ = try await pending.value; XCTFail("Request must be cancelled") }
        catch {}
        XCTAssertNil(vault.read())
    }

    func testActiveEndpointPickedForAuthenticationAndSignaling() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let backup = URL(string: "https://backup.example/api")!
        let api = try AccountClient(baseURL: URL(string: "https://primary.example/api")!, reserve: backup,
                                    transport: URLSession(configuration: config), vault: MemoryVault())
        var writes = 0
        StubProtocol.handle = { request in
            if request.url?.path == "/api/health" {
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                if request.url?.host == "primary.example" { return (503, "{}") }
                return (200, #"{"ok":true,"service":"freetalk-api"}"#)
            }
            XCTAssertEqual(request.url?.host, "backup.example")
            writes += 1
            return (503, "{}")
        }
        do { _ = try await api.login(login: "tester", password: "sample"); XCTFail("Expected service outage") } catch {}
        XCTAssertEqual(writes, 1, "A mutation must never be replayed after an ambiguous outcome")
        let route = try await api.readyEndpoint()
        XCTAssertEqual(route, backup)
        let signal = try await api.signalingURL(roomID: "ABCDEFGHJKLM")
        XCTAssertEqual(signal.host, backup.host)
    }

    func testAttachmentAndMessageActionsUseAuthenticatedEndpoints() async throws {
        let chat = UUID().uuidString, message = UUID().uuidString
        let api = try client(vault: MemoryVault("refresh"))
        var actions: [String] = []
        StubProtocol.handle = { request in
            if request.url!.path.hasSuffix("/refresh") { return (200, "{\"session\":\(self.sessionJSON)}") }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-new")
            actions.append(request.httpMethod! + " " + request.url!.lastPathComponent)
            if request.url!.path.hasSuffix("/files") {
                XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
                return (200, #"{"message":{"id":"m","kind":"file","body":"upload.txt","created_at":"2026-11-01T10:00:00Z","metadata":{"filename":"upload.txt","size":4}}}"#)
            }
            if request.url!.path.hasSuffix("/file") { return (200, "test") }
            return (200, "{}")
        }
        let sent = try await api.sendAttachment(chatID: chat, bytes: Data("test".utf8), filename: "upload.txt", image: false)
        XCTAssertEqual(sent.metadata?.filename, "upload.txt")
        let attachment = try await api.attachment(messageID: message, image: false)
        XCTAssertEqual(attachment, Data("test".utf8))
        try await api.react(messageID: message, emoji: "👍", remove: false)
        try await api.markRead(chatID: chat, messageIDs: [message])
        try await api.forward(messageID: message, to: chat)
        XCTAssertEqual(actions, ["POST files", "GET file", "PUT reactions", "POST reads", "POST forward"])
    }

    func testSavedNotebookUsesPersonalCollectionsContract() async throws {
        let id = UUID().uuidString.lowercased()
        StubProtocol.handle = { request in
            switch request.url?.lastPathComponent {
            case "refresh": return (200, "{\"session\":\(self.sessionJSON)}")
            case "saved":
                XCTAssertEqual(request.httpMethod, "POST")
                return (200, "{\"chat\":{\"id\":\"\(id)\"}}")
            default:
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-Trlka-Chat-Collections"), "1")
                return (200, "{\"chats\":[{\"id\":\"\(id)\",\"type\":\"direct\",\"members\":[],\"isSaved\":true,\"archived\":false}]}")
            }
        }
        let result = try await client(vault: MemoryVault("refresh")).savedChat()
        XCTAssertEqual(result.id, id)
        XCTAssertEqual(result.isSaved, true)
        XCTAssertEqual(result.archived, false)
    }

    func testCaptchaRequirementIsNotBypassed() async throws {
        let vault = MemoryVault()
        StubProtocol.handle = { _ in (403, #"{"code":"CAPTCHA_REQUIRED","message":"Пройдите CAPTCHA"}"#) }
        do { _ = try await client(vault: vault).login(login: "test", password: "test"); XCTFail("Expected CAPTCHA") }
        catch let error as APIError { XCTAssertEqual(error.code, "CAPTCHA_REQUIRED") }
        XCTAssertNil(vault.read())
    }

    func testRejectsMessageWithoutMakingNetworkRequest() async throws {
        StubProtocol.handle = { _ in XCTFail("No network expected"); return (500, "") }
        let api = try client(vault: MemoryVault())
        do { _ = try await api.send(chatID: UUID().uuidString, text: "  "); XCTFail("Expected validation") }
        catch let error as APIError { XCTAssertEqual(error.code, "INVALID_MESSAGE") }
        do { _ = try await api.messages(chatID: "../../auth/logout"); XCTFail("Expected validation") }
        catch let error as APIError { XCTAssertEqual(error.code, "INVALID_ID") }
    }

    func testMessagePageMatchesExistingServerContract() throws {
        let json = #"{"messages":[{"id":"m1","kind":"text","body":"Привет","sender_id":"u1","display_name":"Тест","created_at":"2026-11-01T12:00:00.000Z","expires_at":null,"metadata":{}}],"hasMore":true,"retentionHours":null,"pinnedMessage":null}"#
        let page = try JSONDecoder().decode(MessagePage.self, from: Data(json.utf8))
        XCTAssertEqual(page.messages.first?.senderID, "u1")
        XCTAssertEqual(page.messages.first?.preview, "Привет")
        XCTAssertTrue(page.hasMore)
    }

    func testChatNavigationIdentitySurvivesListRefresh() throws {
        func decode(_ text: String) throws -> Chat {
            try JSONDecoder().decode(Chat.self, from: Data(text.utf8))
        }
        let first = try decode(#"{"id":"c1","type":"group","title":"Команда","lastMessage":"Первое","members":[]}"#)
        let updated = try decode(#"{"id":"c1","type":"group","title":"Новое название","lastMessage":"Следующее","members":[]}"#)
        XCTAssertEqual(first, updated)
        XCTAssertEqual(Set([first, updated]).count, 1)
    }
}
