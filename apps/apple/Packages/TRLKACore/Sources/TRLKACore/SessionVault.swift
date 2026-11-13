import Foundation
import Security

public protocol SessionVault: Sendable {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}

/// Refresh tokens never enter preferences, logs, iCloud sync, or backups.
public struct KeychainSessionVault: SessionVault {
    private let service: String
    public init(service: String = "com.trlka.apple.session") { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: "refresh-token"]
    }

    public func read() throws -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else { throw VaultError(status) }
        return token
    }

    public func write(_ token: String) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let inserted = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw VaultError(inserted) }
        } else if status != errSecSuccess { throw VaultError(status) }
    }

    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError(status) }
    }
}

private struct VaultError: LocalizedError {
    let status: OSStatus
    init(_ status: OSStatus) { self.status = status }
    var errorDescription: String? { "Не удалось сохранить сессию в Связке ключей (\(status))." }
}
