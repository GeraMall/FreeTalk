import Foundation

public struct RegistrationDocument: Decodable, Sendable {
    public let version: String
    public let title: String
    public let content: String
}

public struct Registration: Encodable, Sendable {
    let email, username, password, birthDate, legalVersion: String
    let displayName: String?
    let captchaToken: String?
    let acceptedTerms, acceptedPrivacy: Bool

    public init(email: String, username: String, displayName: String, password: String, birthDate: String,
                legalVersion: String, acceptedTerms: Bool, acceptedPrivacy: Bool, captchaToken: String? = nil) {
        self.email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self.username = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.displayName = name.isEmpty ? nil : name
        self.captchaToken = captchaToken
        self.password = password
        self.birthDate = birthDate
        self.legalVersion = legalVersion
        self.acceptedTerms = acceptedTerms
        self.acceptedPrivacy = acceptedPrivacy
    }

    public static func validPassword(_ text: String) -> Bool {
        (10...256).contains(text.utf16.count) && text.range(of: "[A-Za-zА-Яа-я]", options: .regularExpression) != nil
            && text.range(of: "[0-9]", options: .regularExpression) != nil
    }
}
