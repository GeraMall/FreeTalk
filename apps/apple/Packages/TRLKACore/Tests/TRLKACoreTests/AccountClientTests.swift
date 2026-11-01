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
}
