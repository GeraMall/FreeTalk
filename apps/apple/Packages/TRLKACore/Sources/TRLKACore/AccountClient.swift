import Foundation

/// Serialized session rotation: simultaneous requests share one refresh operation.
public actor AccountClient {
    public static let primaryURL = URL(string: "https://freetalk.185-225-201-129.sslip.io/api")!
    public static let reserveURL = URL(string: "https://freetalk.191-44-38-60.sslip.io/api")!
    private let endpoints: [URL]
    private var baseURL: URL
    private var validUntil = Date.distantPast
    private var probe: Task<URL, Error>?
    private var routeGeneration = 0
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

    @discardableResult public func invite(roomID: String, userIDs: [String]) async throws -> [CallInviteReceipt] {
        struct Input: Encodable { let userIds: [String] }
        let data = try JSONEncoder().encode(Input(userIds: Array(userIDs.prefix(7))))
        let result: CallInvitesResponse = try await request("v1/calls/\(try RoomCode.parse(roomID))/invitations", method: "POST", data: data)
        return result.invitations
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

    public func approveQRLogin(challenge: String) async throws {
        let _: EmptyResponse = try await request("v1/auth/qr/approve", method: "POST", body: ["challenge": challenge])
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
        let trustedRoute = endpoints.contains { url.host == $0.host && url.port == $0.port && url.path.hasPrefix($0.path + "/") }
        let canonicalAsset = endpoints.contains(Self.primaryURL) && url.host == "trlka.com" && url.port == nil && url.path.hasPrefix("/api/v1/")
        guard url.user == nil, url.password == nil, url.scheme == "https", trustedRoute || canonicalAsset else {
            throw URLError(.badURL)
        }
        let route = try await readyEndpoint()
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.host = route.host
        components.port = route.port
        let token = try await realtimeToken()
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await transport.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 5_000_000 else { throw URLError(.badServerResponse) }
        return data
    }

    public init(baseURL: URL = AccountClient.primaryURL, reserve: URL? = nil,
                transport: URLSession = URLSession(configuration: .ephemeral),
                vault: any SessionVault = KeychainSessionVault()) throws {
        let origins = [baseURL] + (reserve == baseURL ? [] : [reserve].compactMap { $0 })
        guard origins.allSatisfy({ $0.scheme == "https" && $0.host != nil && $0.user == nil && $0.password == nil && $0.query == nil && $0.fragment == nil && $0.path == baseURL.path }) else {
            throw APIError(status: 0, code: "INVALID_ENDPOINT", message: "Требуется безопасный адрес сервера HTTPS.")
        }
        self.endpoints = origins
        self.baseURL = baseURL
        self.transport = transport
        self.vault = vault
    }

    /// Only the active deployment serves this health check; a promoted reserve uses the same account data.
    @discardableResult public func readyEndpoint() async throws -> URL {
        if endpoints.count == 1 || validUntil > Date() { return baseURL }
        let ticket = routeGeneration
        let task: Task<URL, Error>
        if let probe { task = probe }
        else {
            let routes = [baseURL] + endpoints.filter { $0 != baseURL }
            task = Task { [transport] in
                struct Health: Decodable { let ok: Bool; let service: String }
                for route in routes {
                    try Task.checkCancellation()
                    var request = URLRequest(url: route.appendingPathComponent("health"))
                    request.timeoutInterval = 3
                    request.cachePolicy = .reloadIgnoringLocalCacheData
                    if let (bytes, response) = try? await transport.data(for: request),
                       (response as? HTTPURLResponse)?.statusCode == 200,
                       response.url?.host == route.host,
                       let health = try? JSONDecoder().decode(Health.self, from: bytes),
                       health.ok && health.service == "freetalk-api" { return route }
                }
                throw URLError(.cannotConnectToHost)
            }
            probe = task
        }
        do {
            let route = try await task.value
            if ticket == routeGeneration {
                baseURL = route
                validUntil = Date().addingTimeInterval(15)
                probe = nil
                routeGeneration += 1
            }
            try Task.checkCancellation()
            return route
        } catch {
            if ticket == routeGeneration { probe = nil; routeGeneration += 1 }
            throw error
        }
    }

    private func invalidate(_ route: URL) {
        guard endpoints.count > 1, baseURL == route else { return }
        validUntil = .distantPast
        routeGeneration += 1
        probe?.cancel()
        probe = nil
        baseURL = endpoints.first(where: { $0 != route }) ?? route
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
        let expected = generation
        do {
            try await refresh()
            guard generation == expected else { throw CancellationError() }
            let response: UserResponse = try await request("v1/me")
            return response.user
        } catch let error as APIError where error.status == 401 {
            guard generation == expected else { throw CancellationError() }
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

    public func savedChat() async throws -> Chat {
        struct Created: Decodable { struct Reference: Decodable { let id: String }; let chat: Reference }
        let result: Created = try await request("v1/chats/saved", method: "POST")
        guard let chat = try await chats().first(where: { $0.id == result.chat.id }) else { throw URLError(.badServerResponse) }
        return chat
    }

    public func archive(chatID: String, archived: Bool) async throws {
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/archive", method: "PATCH",
                                                data: try JSONEncoder().encode(["archived": archived]))
    }

    public func setPreference(chatID: String, pinned: Bool? = nil, muted: Bool? = nil) async throws {
        let patch = ["pinned": pinned, "muted": muted].compactMapValues { $0 }
        guard !patch.isEmpty else { return }
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/preferences", method: "PATCH",
                                                data: try JSONEncoder().encode(patch))
    }

    public func messages(chatID: String, before: String? = nil) async throws -> MessagePage {
        var query: [URLQueryItem] = []
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await request("v1/chats/\(try identifier(chatID))/messages", query: query)
    }

    public func send(chatID: String, text: String, replyingTo: String? = nil) async throws -> Message {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body.utf16.count <= 4000 else {
            throw APIError(status: 0, code: "INVALID_MESSAGE", message: "Сообщение должно содержать от 1 до 4000 символов.")
        }
        var fields = ["body": body]
        if let replyingTo { fields["replyToMessageId"] = try identifier(replyingTo) }
        let response: MessageResponse = try await request("v1/chats/\(try identifier(chatID))/messages",
                                                         method: "POST", body: fields)
        return response.message
    }

    public func edit(messageID: String, text: String) async throws {
        let _: EmptyResponse = try await request("v1/messages/\(try identifier(messageID))", method: "PATCH", body: ["body": text])
    }
    public func delete(messageID: String) async throws {
        let _: EmptyResponse = try await request("v1/messages/\(try identifier(messageID))", method: "DELETE")
    }
    public func react(messageID: String, emoji: String, remove: Bool) async throws {
        struct Change: Encodable { let emoji: String; let remove: Bool }
        let _: EmptyResponse = try await request("v1/messages/\(try identifier(messageID))/reactions", method: "PUT",
                                                data: try JSONEncoder().encode(Change(emoji: emoji, remove: remove)))
    }
    public func forward(messageID: String, to chatID: String) async throws {
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/messages/forward",
                                                method: "POST", body: ["sourceMessageId": try identifier(messageID)])
    }
    public func typing(chatID: String, active: Bool) async throws {
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/typing", method: "POST",
                                                data: try JSONEncoder().encode(["active": active]))
    }
    public func markRead(chatID: String, messageIDs: [String]) async throws {
        guard !messageIDs.isEmpty else { return }
        let _: EmptyResponse = try await request("v1/chats/\(try identifier(chatID))/reads", method: "POST",
                                                data: try JSONEncoder().encode(["ids": try messageIDs.prefix(50).map(identifier)]))
    }
    public func readers(chatID: String, messageID: String) async throws -> [MessageReader] {
        struct Result: Decodable { let readers: [MessageReader] }
        let result: Result = try await request("v1/chats/\(try identifier(chatID))/messages/\(try identifier(messageID))/readers")
        return result.readers
    }

    public func sendAttachment(chatID: String, bytes: Data, filename: String, image: Bool, thumbnail: Data? = nil) async throws -> Message {
        let path = "v1/chats/\(try identifier(chatID))/\(image ? "images" : "files")"
        guard !bytes.isEmpty, bytes.count <= (image ? 3 : 30) * 1024 * 1024,
              (thumbnail?.count ?? 0) <= 256 * 1024 else {
            throw APIError(status: 0, code: "INVALID_FILE", message: "Файл пуст или превышает допустимый размер.")
        }
        let boundary = UUID().uuidString
        var form = Data()
        func append(_ name: String, _ filename: String, _ mime: String, _ bytes: Data) {
            let safe = filename.components(separatedBy: CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "\"\\/"))).joined(separator: "_")
            form.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(String(safe.prefix(140)))\"\r\nContent-Type: \(mime)\r\n\r\n".utf8))
            form.append(bytes)
            form.append(Data("\r\n".utf8))
        }
        append(image ? "image" : "file", filename, image ? "image/jpeg" : "application/octet-stream", bytes)
        if image, let thumbnail { append("thumbnail", "preview.jpg", "image/jpeg", thumbnail) }
        form.append(Data("--\(boundary)--\r\n".utf8))
        let result: MessageResponse = try await request(path, method: "POST", data: form, contentType: "multipart/form-data; boundary=\(boundary)")
        return result.message
    }

    public func attachment(messageID: String, image: Bool, thumbnail: Bool = false) async throws -> Data {
        let path = "v1/messages/\(try identifier(messageID))/\(image ? "image" : "file")"
        let bytes: Data = try await request(path, query: image && thumbnail ? [URLQueryItem(name: "variant", value: "thumbnail")] : [])
        guard !bytes.isEmpty, bytes.count <= (image ? 3 : 30) * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
        return bytes
    }

    public func forgotPassword(email: String) async throws {
        let _: EmptyResponse = try await publicRequest("v1/auth/forgot-password", method: "POST",
                                                      body: ["email": email, "codeFormat": "numeric"])
    }

    public func appearance() async throws -> AccountAppearance {
        let result: AppearanceResponse = try await request("v1/me/appearance")
        return result.appearance
    }

    public func setAppearance(theme: String, syncEnabled: Bool) async throws {
        let data = try JSONEncoder().encode(AccountAppearance(theme: theme, syncEnabled: syncEnabled))
        let _: AppearanceResponse = try await request("v1/me/appearance", method: "PUT", data: data)
    }

    public func legalDocument(privacy: Bool) async throws -> RegistrationDocument {
        try await publicRequest(privacy ? "v1/legal/privacy" : "v1/legal/terms")
    }

    public func register(_ registration: Registration) async throws {
        let _: EmptyResponse = try await publicRequest("v1/auth/register", method: "POST",
            data: try JSONEncoder().encode(registration))
    }

    public func resendVerification(email: String) async throws {
        let _: EmptyResponse = try await publicRequest("v1/auth/resend-verification", method: "POST", body: ["email": email])
    }

    public func verifyEmail(email: String, code: String) async throws -> AccountUser {
        generation += 1
        let expected = generation
        let result: LoginResponse = try await publicRequest("v1/auth/verify-email", method: "POST",
                                                            body: ["email": email, "code": code])
        guard expected == generation else { throw CancellationError() }
        try accept(result.session)
        return result.user
    }

    public func resetPassword(email: String, code: String, password: String) async throws {
        let _: EmptyResponse = try await publicRequest("v1/auth/reset-password", method: "POST",
                                                      body: ["email": email, "token": code, "password": password])
    }

    public func serviceMessages(search: String = "") async throws -> [ServiceMessage] {
        let result: ServiceHistory = try await request("v1/service-chat/messages", query: [URLQueryItem(name: "search", value: String(search.prefix(200)))])
        return result.messages
    }
    public func sendServiceMessage(_ text: String, requestID: UUID) async throws {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf16.count <= 4000 else { throw APIError(status: 0, code: "INVALID_MESSAGE", message: "Сообщение должно содержать от 1 до 4000 символов.") }
        let _: EmptyResponse = try await request("v1/service-chat/messages", method: "POST", body: ["requestId": requestID.uuidString.lowercased(), "body": value, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Apple"])
    }
    public func profile(userID: String) async throws -> PeerProfile {
        let result: PeerProfileResponse = try await request("v1/users/\(try identifier(userID))/profile")
        return result.profile
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
                                       query: [URLQueryItem] = [], data: Data? = nil, contentType: String = "application/json") async throws -> T {
        let expected = generation
        if accessToken == nil { try await refresh() }
        guard generation == expected, let token = accessToken else { throw CancellationError() }
        let result: T
        do {
            result = try await publicRequest(path, method: method, body: body, query: query, bearer: token, data: data, contentType: contentType)
        } catch let error as APIError where error.status == 401 {
            // Never replay an old account's request with a newly signed-in account's token.
            guard generation == expected else { throw CancellationError() }
            if accessToken == token { try await refresh() }
            guard generation == expected, let renewed = accessToken else { throw CancellationError() }
            result = try await publicRequest(path, method: method, body: body, query: query, bearer: renewed, data: data, contentType: contentType)
        }
        guard generation == expected else { throw CancellationError() }
        return result
    }

    private func publicRequest<T: Decodable>(_ path: String, method: String = "GET",
                                             body: [String: String]? = nil,
                                             query: [URLQueryItem] = [], bearer: String? = nil, data: Data? = nil, contentType: String = "application/json") async throws -> T {
        let base = try await readyEndpoint()
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if path == "v1/chats" && method == "GET" { request.setValue("1", forHTTPHeaderField: "X-Trlka-Chat-Collections") }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let data {
            request.httpBody = data
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await execute(request, base: base)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            let message = http.statusCode >= 500 ? "Сервер временно недоступен. Попробуйте снова." :
                (failure?.message ?? "Не удалось выполнить запрос.")
            throw APIError(status: http.statusCode, code: failure?.code ?? "REQUEST_FAILED", message: message)
        }
        if T.self == Data.self { return data as! T }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func execute(_ request: URLRequest, base: URL) async throws -> (Data, URLResponse) {
        do {
            let result = try await transport.data(for: request)
            let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            guard endpoints.count > 1, [502, 503, 504].contains(status) else { return result }
            invalidate(base)
            if request.httpMethod != "GET" { return result }
        } catch let error as URLError {
            try Task.checkCancellation()
            if error.code == .cancelled { throw error }
            invalidate(base)
            guard endpoints.count > 1, request.httpMethod == "GET" else { throw error }
        }
        let next = try await readyEndpoint()
        var parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        parts.host = next.host
        parts.port = next.port
        var retry = request
        retry.url = parts.url
        return try await transport.data(for: retry)
    }
}

private struct EmptyResponse: Decodable {}
private struct Failure: Decodable { let code: String?; let message: String? }
