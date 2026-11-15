import SwiftUI
import TRLKACore

struct RoomMessageFile: Decodable, Sendable {
    let id: UUID
    let name: String
    let mime: String
    let image: Bool
    let size: Int
}

struct RoomMessage: Decodable, Identifiable {
    struct Reaction: Decodable { let emoji: String; let userIds: [String] }
    let id: String
    let participantId: String
    let senderName: String
    let senderAvatar: String?
    let text: String
    let timestamp: Double
    let attachment: RoomMessageFile?
    let replyTo: String?
    let editedAt: Double?
    let deleted: Bool?
    let reactions: [Reaction]?
}

private final class RoomFileRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor @Observable
final class NativeRoomChat {
    private(set) var messages: [RoomMessage] = []
    private(set) var typing: [String: String] = [:]
    private(set) var joined = false
    private(set) var supportsActions = false
    private var selfID = ""
    private var filesURL: URL?
    private var fileToken: String?
    private var lastTyping = Date.distantPast
    private var generation = 0
    @ObservationIgnored var transmit: (([String: Any]) -> Bool)?
    @ObservationIgnored private var expiries: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var transport: URLSession?
    var supportsFiles: Bool { joined && filesURL != nil && fileToken != nil }

    func join(snapshot: [String: Any], socketURL: URL?, selfID: String) {
        disconnect()
        self.selfID = selfID
        joined = true
        supportsActions = snapshot["roomChatVersion"] as? Int == 2
        messages = (snapshot["roomChatMessages"] as? [[String: Any]] ?? []).suffix(200).compactMap(decode)
        if let socketURL, var url = URLComponents(url: socketURL, resolvingAgainstBaseURL: false),
           url.scheme == "wss", let token = snapshot["roomChatToken"] as? String, UUID(uuidString: token) != nil {
            url.scheme = "https"; url.query = nil; url.path = "/room-chat/files"
            filesURL = url.url; fileToken = token
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false; config.urlCache = nil; config.timeoutIntervalForRequest = 30
            transport = URLSession(configuration: config, delegate: RoomFileRedirectPolicy(), delegateQueue: nil)
        }
    }

    func receive(_ message: [String: Any]) {
        guard joined, let type = message["type"] as? String else { return }
        if type == "room-chat-typing" {
            guard let id = message["participantId"] as? String, id != selfID else { return }
            forgetTypist(id)
            guard let until = message["expiresAt"] as? Double, until > 0, let name = message["name"] as? String else { return }
            typing[id] = name
            expiries[id] = Task {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                forgetTypist(id)
            }
            return
        }
        guard let raw = message["message"] as? [String: Any], let value = decode(raw) else { return }
        if let index = messages.firstIndex(where: { $0.id == value.id }) { messages[index] = value }
        else if type == "room-chat-message" {
            messages.append(value)
            if messages.count > 200 { messages.removeFirst(messages.count - 200) }
        }
        if type == "room-chat-message" { forgetTypist(value.participantId) }
    }

    func forgetTypist(_ id: String) {
        expiries.removeValue(forKey: id)?.cancel(); typing.removeValue(forKey: id)
    }

    func disconnect() {
        generation += 1
        joined = false; supportsActions = false; filesURL = nil; fileToken = nil
        transport?.invalidateAndCancel(); transport = nil
        expiries.values.forEach { $0.cancel() }; expiries.removeAll(); typing.removeAll(); lastTyping = .distantPast
    }

    func clear() { disconnect(); selfID = ""; messages.removeAll() }

    func send(_ text: String, attachment: UUID? = nil, reply: String? = nil) throws {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf16.count <= 2000 else { throw issue("Сообщение должно содержать от 1 до 2000 символов.") }
        var frame: [String: Any] = ["type": "room-chat-message", "id": UUID().uuidString.lowercased(), "text": value]
        if let attachment { frame["attachmentId"] = attachment.uuidString.lowercased() }
        if let reply { frame["replyTo"] = reply }
        guard joined, transmit?(frame) == true else { throw issue("Дождитесь подключения к комнате.") }
    }

    @discardableResult func action(_ action: [String: Any]) -> Bool {
        joined && supportsActions && transmit?(["type": "room-chat-action", "action": action]) == true
    }

    func notifyTyping(_ active: Bool) {
        if active {
            guard Date().timeIntervalSince(lastTyping) >= 2 else { return }
            lastTyping = Date()
        } else {
            guard lastTyping != .distantPast else { return }
            lastTyping = .distantPast
        }
        action(["kind": "typing", "active": active])
    }

    func upload(_ bytes: Data, name: String, mime: String) async throws -> RoomMessageFile {
        guard !bytes.isEmpty, bytes.count <= 10 * 1024 * 1024 else { throw issue("Выберите непустой файл до 10 МБ.") }
        let data = try await transfer(nil, bytes: bytes, name: name, mime: mime)
        struct Result: Decodable { let attachment: RoomMessageFile }
        return try JSONDecoder().decode(Result.self, from: data).attachment
    }

    func download(_ file: RoomMessageFile) async throws -> Data { try await transfer(file.id) }

    private func transfer(_ id: UUID?, bytes: Data? = nil, name: String = "", mime: String = "") async throws -> Data {
        guard joined, let url = filesURL, let token = fileToken, let session = transport else {
            throw issue("Вложения доступны после подключения к комнате.")
        }
        let expected = generation
        var request = URLRequest(url: id.map { url.appendingPathComponent($0.uuidString.lowercased()) } ?? url)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let bytes {
            request.httpMethod = "POST"; request.httpBody = bytes
            request.setValue(mime, forHTTPHeaderField: "Content-Type")
            request.setValue(name.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-File-Name")
        }
        let (data, response) = try await session.data(for: request)
        guard generation == expected else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let reason = (try? JSONDecoder().decode([String: String].self, from: data))?["message"]
            throw issue(reason ?? "Не удалось получить вложение комнаты.")
        }
        return data
    }

    private func decode(_ value: [String: Any]) -> RoomMessage? {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(RoomMessage.self, from: data)
    }
    private func issue(_ text: String) -> APIError { APIError(status: 0, code: "ROOM_CHAT", message: text) }
}
