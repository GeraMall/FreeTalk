#if DEBUG
import Foundation
import TRLKACore

/// Deterministic UI fixtures only in Debug builds. No production network or accounts.
enum PreviewFixtures {
    static var mode: String? {
        guard let index = CommandLine.arguments.firstIndex(of: "--ui-preview"), CommandLine.arguments.count > index + 1 else { return nil }
        return CommandLine.arguments[index + 1]
    }
    static let userID = "11111111-1111-4111-8111-111111111111"
    static let friendID = "22222222-2222-4222-8222-222222222222"
    static let chatID = "33333333-3333-4333-8333-333333333333"
    static var user: [String: Any] { ["id": userID, "username": "alex", "displayName": "Alex", "avatarUrl": NSNull(), "bio": "Всегда на связи"] }
    static var member: [String: Any] { ["id": friendID, "username": "max", "displayName": "Макс", "avatarUrl": NSNull()] }
    static var chatJSON: [String: Any] { ["id": chatID, "type": "direct", "title": NSNull(), "lastMessage": "Давай созвонимся вечером", "lastMessageAt": "2026-11-01T12:00:00Z", "members": [user, member]] }
    static var chat: Chat { try! JSONDecoder().decode(Chat.self, from: JSONSerialization.data(withJSONObject: chatJSON)) }
    static var participants: [RoomParticipant] {
        let values: [[String: Any]] = [
            ["id": userID, "accountId": userID, "name": "Alex", "muted": false, "isOwner": true],
            ["id": friendID, "accountId": friendID, "name": "Макс", "muted": false, "isOwner": false]
        ]
        return try! JSONDecoder().decode([RoomParticipant].self, from: JSONSerialization.data(withJSONObject: values))
    }
    static func response(_ path: String) -> [String: Any] {
        if path.hasSuffix("/auth/refresh") {
            return ["session": ["accessToken": "preview-access", "refreshToken": "preview-refresh", "accessExpiresAt": "2099-01-01T00:00:00Z", "refreshExpiresAt": "2099-01-01T00:00:00Z"]]
        }
        if path.hasSuffix("/me") { return ["user": user] }
        if path.hasSuffix("/chats") { return ["chats": [chatJSON]] }
        if path.hasSuffix("/friends") { return ["friends": [["id": friendID, "username": "max", "display_name": "Макс", "presence": "online"]]] }
        if path.hasSuffix("/history") {
            return ["calls": [["id": chatID, "room_id": "ABCDEFGHJKLM", "room_name": "Комната с друзьями", "started_at": "2026-11-01T12:00:00Z", "duration_seconds": 2400, "participants": [["displayName": "Макс"]]]]]
        }
        if path.hasSuffix("/messages") {
            let text = ["Привет! Как дела?", "Привет, всё отлично", "Давай созвонимся вечером", "Да, я уже здесь"]
            return ["messages": text.enumerated().map { index, body in
                ["id": "message-\(index)", "kind": "text", "body": body, "sender_id": index.isMultiple(of: 2) ? friendID : userID,
                 "display_name": index.isMultiple(of: 2) ? "Макс" : "Alex", "created_at": "2026-11-01T12:00:00Z"]
            }, "hasMore": false]
        }
        return [:]
    }
}

final class PreviewProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let result = PreviewFixtures.response(url.path)
        let response = HTTPURLResponse(url: url, statusCode: result.isEmpty ? 403 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: result))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
struct PreviewVault: SessionVault {
    func read() throws -> String? { "preview-refresh" }
    func write(_ token: String) throws {}
    func clear() throws {}
}
#endif
