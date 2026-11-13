import Foundation

public struct AccountAppearance: Codable, Sendable {
    public let theme: String
    public let syncEnabled: Bool
}

struct AppearanceResponse: Decodable {
    let appearance: AccountAppearance
}
