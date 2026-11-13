import Foundation

public enum RoomCode {
    public static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    public static func generate() -> String { String((0..<12).map { _ in alphabet.randomElement()! }) }
    public static func parse(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let value: String
        if let url = URLComponents(string: trimmed), url.host != nil {
            value = url.queryItems?.first(where: { $0.name == "room" })?.value ??
                url.path.split(separator: "/").last.map(String.init) ?? ""
        } else { value = trimmed }
        let code = value.uppercased()
        guard code.count == 12, code.allSatisfy({ alphabet.contains($0) }) else {
            throw APIError(status: 0, code: "INVALID_ROOM", message: "Введите код комнаты из 12 символов или ссылку-приглашение.")
        }
        return code
    }
}

public enum WireDate {
    public static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

public struct RoomParticipant: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let accountId: String?
    public let name: String
    public let avatar: String?
    public var muted: Bool
    public var deafened: Bool?
    public var isOwner: Bool
}

public struct ActiveCall: Decodable, Sendable {
    public let roomId: String
    public let chatId: String?
    public let title: String?
    public let memberIds: [String]?
}
struct ActiveCallResponse: Decodable { let call: ActiveCall? }
public struct CallInvitationResult: Decodable, Sendable {
    public let roomId: String
    public let chatId: String?
}
struct CallInvitationResponse: Decodable { let invitation: CallInvitationResult }
public struct CallInviteReceipt: Decodable, Sendable {
    public let userId: String
    public let expiresAt: String
}
struct CallInvitesResponse: Decodable { let invitations: [CallInviteReceipt] }

public struct IncomingCall: Decodable, Identifiable, Sendable {
    public var id: String { invitationId }
    public let invitationId: String
    public let roomId: String
    public let inviter: Inviter
    public let expiresAt: String
    public struct Inviter: Decodable, Sendable {
        public let displayName: String
        public let avatarUrl: String?
    }
}

public struct Friend: Decodable, Sendable, Identifiable {
    public let id: String
    public let username: String
    public let display_name: String
    public let avatarUrl: String?
    public let presence: String?
}
struct FriendsResponse: Decodable { let friends: [Friend] }

public struct CallHistoryItem: Decodable, Sendable, Identifiable {
    public let id: String
    public let room_id: String
    public let room_name: String?
    public let started_at: String
    public let duration_seconds: Int
    public let participants: [Person]
    public struct Person: Decodable, Sendable {
        public let displayName: String
        public let avatarUrl: String?
    }
}
struct HistoryResponse: Decodable { let calls: [CallHistoryItem] }
