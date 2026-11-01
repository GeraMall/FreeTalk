import Foundation

public struct AccountUser: Codable, Sendable, Equatable {
    public let id: String
    public let username: String
    public let displayName: String
    public let avatarUrl: String?
    public let bio: String?
    public let coverUrl: String?
}

public struct ChatMember: Codable, Sendable, Hashable {
    public let id: String
    public let username: String
    public let displayName: String
    public let avatarUrl: String?
}

public struct Chat: Codable, Identifiable, Sendable, Hashable {
    public let id: String
    public let type: String
    public let title: String?
    public let lastMessage: String?
    public let lastMessageAt: String?
    public let members: [ChatMember]

    // Navigation selection must survive an updated last message or member list.
    public static func == (lhs: Chat, rhs: Chat) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }

    public func name(currentUserID: String?) -> String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        let names = members.filter { $0.id != currentUserID }.map(\.displayName)
        return names.isEmpty ? "Избранное" : names.joined(separator: ", ")
    }
}

public struct Message: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let kind: String
    public let body: String
    public let senderID: String?
    public let displayName: String?
    public let avatarURL: String?
    public let createdAt: String
    public let metadata: Metadata?
    public struct Metadata: Codable, Sendable, Equatable {
        public let roomId: String?
        public let ended: Bool?
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, body, metadata
        case senderID = "sender_id", displayName = "display_name", createdAt = "created_at"
        case avatarURL = "avatar_url"
    }

    public var preview: String {
        switch kind {
        case "image": return body.isEmpty ? "Фотография" : body
        case "file": return body.isEmpty ? "Файл" : body
        case "call": return "Звонок"
        default: return body
        }
    }
}

public struct MessagePage: Decodable, Sendable {
    public let messages: [Message]
    public let hasMore: Bool
}

struct Session: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let accessExpiresAt: String
    let refreshExpiresAt: String
}

struct LoginResponse: Decodable { let user: AccountUser; let session: Session }
struct RefreshResponse: Decodable { let session: Session }
struct UserResponse: Decodable { let user: AccountUser }
struct ChatsResponse: Decodable { let chats: [Chat] }
struct MessageResponse: Decodable { let message: Message }

public struct APIError: Error, LocalizedError, Sendable, Equatable {
    public let status: Int
    public let code: String
    public let message: String
    public init(status: Int, code: String, message: String) {
        self.status = status; self.code = code; self.message = message
    }
    public var errorDescription: String? { message }
}
