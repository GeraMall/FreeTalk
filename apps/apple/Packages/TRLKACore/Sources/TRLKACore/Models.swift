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
    public static let serviceID = "00000000-0000-4000-a000-00000000724c"
    public static var service: Chat { Chat(id: serviceID, type: "service", title: "TRLKA", lastMessage: "Уведомления и помощь", lastMessageAt: nil, members: []) }
    public var isService: Bool { id == Self.serviceID }
    public let id: String
    public let type: String
    public let title: String?
    public let lastMessage: String?
    public let lastMessageAt: String?
    public let members: [ChatMember]
    public var isSaved: Bool? = nil
    public var archived: Bool? = nil
    public var pinned: Bool? = nil
    public var muted: Bool? = nil

    // Navigation selection must survive an updated last message or member list.
    public static func == (lhs: Chat, rhs: Chat) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }

    public func name(currentUserID: String?) -> String {
        if isSaved == true { return "Избранное" }
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        let names = members.filter { $0.id != currentUserID }.map(\.displayName)
        return names.isEmpty ? "Избранное" : names.joined(separator: ", ")
    }
}

public struct ServiceMessage: Decodable, Identifiable, Sendable {
    public let id: String
    public let author: String
    public let kind: String
    public let body: String
    public let created_at: String
}
struct ServiceHistory: Decodable { let messages: [ServiceMessage] }
public struct PeerProfile: Decodable, Sendable {
    public let displayName: String
    public let username: String
    public let avatarUrl: String?
    public let coverUrl: String?
    public let bio: String?
}
struct PeerProfileResponse: Decodable { let profile: PeerProfile }

public struct Message: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let kind: String
    public let body: String
    public let senderID: String?
    public let displayName: String?
    public let avatarURL: String?
    public let createdAt: String
    public let metadata: Metadata?
    public let replyTo: QuotedMessage?
    public let reactions: [Reaction]?
    public struct QuotedMessage: Codable, Equatable, Sendable {
        public let kind: String
        public let body: String
        public let display_name: String?
    }
    public struct Reaction: Codable, Equatable, Sendable {
        public let emoji: String
        public let count: Int
        public let userIds: [String]
    }
    public struct Metadata: Codable, Sendable, Equatable {
        public let roomId: String?
        public let ended: Bool?
        public let filename: String?
        public let size: Int?
        public let deleted: Bool?
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, body, metadata, reactions
        case replyTo = "reply_to"
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
public struct MessageReader: Decodable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let readAt: String
    public let avatarUrl: String?
}
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
