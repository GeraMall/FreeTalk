import Foundation

/// Serialized session rotation: simultaneous requests share one refresh operation.
public actor AccountClient {
    private let baseURL: URL
    private let transport: URLSession
    private let vault: any SessionVault
    private var accessToken: String?
    private var refreshTask: Task<Session, Error>?
    private var generation = 0
    private var accessExpiry = Date.distantPast

    public func realtimeToken() async throws -> String {
        if accessToken == nil || accessExpiry.timeIntervalSinceNow < 30 { try await refresh() }
        guard let accessToken else { throw URLError(.userAuthenticationRequired) }
        return accessToken
    }

    public func realtimeURL() -> URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/chats/realtime"), resolvingAgainstBaseURL: false)!
        components.scheme = "wss"
        return components.url!
    }

    public func signalingURL(roomID: String) throws -> URL {
        let code = try RoomCode.parse(roomID)
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = "wss"
        components.path = "/ws"
        components.queryItems = [URLQueryItem(name: "room", value: code)]
        return components.url!
    }

    public func activeCall(chatID: String) async throws -> ActiveCall? {
        let result: ActiveCallResponse = try await request("v1/chats/\(try identifier(chatID))/active-call")
        return result.call
    }

    public func registerCall(chatID: String, roomID: String) async throws {
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/calls", method: "POST", body: ["roomId": try RoomCode.parse(roomID)])
    }

    public func callContext(roomID: String) async throws -> ActiveCall {
        let result: ActiveCallResponse = try await request("v1/calls/\(try RoomCode.parse(roomID))/context")
        guard let call = result.call else { throw URLError(.resourceUnavailable) }
        return call
    }

    public func invite(roomID: String, userIDs: [String]) async throws {
        struct Input: Encodable { let userIds: [String] }
        let data = try JSONEncoder().encode(Input(userIds: Array(userIDs.prefix(7))))
        let _: EmptyResponse = try await request("v1/calls/\(try RoomCode.parse(roomID))/invitations", method: "POST", data: data)
    }

    public func respond(invitationID: String, accept: Bool) async throws -> CallInvitationResult {
        let result: CallInvitationResponse = try await request("v1/call-invitations/\(try identifier(invitationID))/respond", method: "POST", body: ["action": accept ? "accept" : "decline"])
        return result.invitation
    }

    public func friends() async throws -> [Friend] {
        let result: FriendsResponse = try await request("v1/friends")
        return result.friends
    }

    public func createChat(memberIDs: [String], title: String? = nil) async throws -> Chat {
        struct Input: Encodable { let type: String; let memberIds: [String]; let title: String? }
        struct Output: Decodable { struct Reference: Decodable { let id: String }; let chat: Reference }
        let data = try JSONEncoder().encode(Input(type: memberIDs.count == 1 ? "direct" : "group", memberIds: memberIDs, title: title))
        let result: Output = try await request("v1/chats", method: "POST", data: data)
        guard let chat = try await chats().first(where: { $0.id == result.chat.id }) else { throw URLError(.badServerResponse) }
        return chat
    }

    public func addFriend(username: String) async throws {
        let _: EmptyResponse = try await request("v1/friends/requests", method: "POST", body: ["username": username.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "@", with: "").lowercased()])
    }

    public func updateProfile(displayName: String, bio: String) async throws -> AccountUser {
        let response: UserResponse = try await request("v1/me", method: "PATCH", body: ["displayName": displayName, "bio": bio])
        return response.user
    }

    public func history() async throws -> [CallHistoryItem] {
        let result: HistoryResponse = try await request("v1/history")
        return result.calls
    }

    public func avatarData(url: URL) async throws -> Data {
        guard url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port,
              url.path.hasPrefix(baseURL.path + "/") else { throw URLError(.badURL) }
        let token = try await realtimeToken()
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await transport.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 5_000_000 else { throw URLError(.badServerResponse) }
        return data
    }

    public init(baseURL: URL = URL(string: "https://freetalk.191-44-38-60.sslip.io/api")!,
                transport: URLSession = URLSession(configuration: .ephemeral),
                vault: any SessionVault = KeychainSessionVault()) throws {
        guard baseURL.scheme == "https", baseURL.host != nil,
              baseURL.user == nil, baseURL.password == nil,
              baseURL.query == nil, baseURL.fragment == nil else {
            throw APIError(status: 0, code: "INVALID_ENDPOINT", message: "Требуется безопасный адрес сервера HTTPS.")
        }
        self.baseURL = baseURL
        self.transport = transport
        self.vault = vault
    }

    public func login(login: String, password: String, captchaToken: String? = nil) async throws -> AccountUser {
        generation += 1
        let expected = generation
        var body = ["login": login.trimmingCharacters(in: .whitespacesAndNewlines), "password": password]
        if let captchaToken { body["captchaToken"] = captchaToken }
        let result: LoginResponse = try await publicRequest("v1/auth/login", method: "POST", body: body)
        guard expected == generation else { throw CancellationError() }
        try accept(result.session)
        return result.user
    }

    public func restore() async throws -> AccountUser? {
        guard try vault.read() != nil else { return nil }
        do {
            try await refresh()
            let response: UserResponse = try await request("v1/me")
            return response.user
        } catch let error as APIError where error.status == 401 {
            try clear()
            return nil
        }
        // Offline/server failures retain the saved session for a later retry.
    }

    public func logout() async throws {
        let token = accessToken
        try clear()
        if let token {
            let _: EmptyResponse = try await publicRequest("v1/auth/logout", method: "POST", bearer: token)
        }
    }

    public func chats() async throws -> [Chat] {
        let response: ChatsResponse = try await request("v1/chats")
        return response.chats
    }

    public func messages(chatID: String, before: String? = nil) async throws -> MessagePage {
        var query: [URLQueryItem] = []
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await request("v1/chats/\(try identifier(chatID))/messages", query: query)
    }

    public func send(chatID: String, text: String) async throws -> Message {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body.utf16.count <= 4000 else {
            throw APIError(status: 0, code: "INVALID_MESSAGE", message: "Сообщение должно содержать от 1 до 4000 символов.")
        }
        let response: MessageResponse = try await request("v1/chats/\(try identifier(chatID))/messages",
                                                         method: "POST", body: ["body": body])
        return response.message
    }

    public func forgotPassword(email: String) async throws {
        let _: EmptyResponse = try await publicRequest("v1/auth/forgot-password", method: "POST",
                                                      body: ["email": email, "codeFormat": "numeric"])
    }

    private func identifier(_ value: String) throws -> String {
        guard UUID(uuidString: value) != nil else {
            throw APIError(status: 0, code: "INVALID_ID", message: "Некорректный идентификатор чата.")
        }
        return value
    }

    private func clear() throws {
        generation += 1
        refreshTask?.cancel()
        refreshTask = nil
        accessToken = nil
        accessExpiry = .distantPast
        try vault.clear()
    }

    private func accept(_ session: Session) throws {
        try vault.write(session.refreshToken)
        accessToken = session.accessToken
        accessExpiry = WireDate.parse(session.accessExpiresAt) ?? .distantPast
    }

    private func refresh() async throws {
        if let refreshTask { _ = try await refreshTask.value; return }
        guard let token = try vault.read() else {
            throw APIError(status: 401, code: "NO_SESSION", message: "Войдите в аккаунт.")
        }
        let expected = generation
        let task = Task<Session, Error> { try await self.rotate(token: token, expected: expected) }
        refreshTask = task
        do {
            _ = try await task.value
            guard generation == expected else { throw CancellationError() }
            refreshTask = nil
        } catch {
            if generation == expected { refreshTask = nil }
            throw error
        }
    }

    private func rotate(token: String, expected: Int) async throws -> Session {
        let response: RefreshResponse = try await publicRequest("v1/auth/refresh", method: "POST",
                                                                body: ["refreshToken": token])
        guard generation == expected else { throw CancellationError() }
        try accept(response.session)
        return response.session
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET",
                                       body: [String: String]? = nil,
                                       query: [URLQueryItem] = [], data: Data? = nil) async throws -> T {
        if accessToken == nil { try await refresh() }
        let token = accessToken
        do { return try await publicRequest(path, method: method, body: body, query: query, bearer: token, data: data) }
        catch let error as APIError where error.status == 401 {
            // A concurrent request may already have rotated this token.
            if accessToken == token { try await refresh() }
            return try await publicRequest(path, method: method, body: body, query: query, bearer: accessToken, data: data)
        }
    }

    private func publicRequest<T: Decodable>(_ path: String, method: String = "GET",
                                             body: [String: String]? = nil,
                                             query: [URLQueryItem] = [], bearer: String? = nil, data: Data? = nil) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let data {
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            let message = http.statusCode >= 500 ? "Сервер временно недоступен. Попробуйте снова." :
                (failure?.message ?? "Не удалось выполнить запрос.")
            throw APIError(status: http.statusCode, code: failure?.code ?? "REQUEST_FAILED", message: message)
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct EmptyResponse: Decodable {}
private struct Failure: Decodable { let code: String?; let message: String? }
