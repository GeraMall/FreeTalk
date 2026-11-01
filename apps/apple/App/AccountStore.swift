import SwiftUI
import TRLKACore

@MainActor @Observable
final class AccountStore {
    enum Phase { case restoring, signedOut, signedIn, unavailable }
    var phase: Phase = .restoring
    var user: AccountUser?
    var error: String?
    var working = false
    let client: AccountClient

    init() {
        // Build configuration only; never accept server addresses from deep links.
        let endpoint = Bundle.main.object(forInfoDictionaryKey: "TRLKAAPIBaseURL") as? String
        client = try! AccountClient(baseURL: URL(string: endpoint ?? "https://freetalk.191-44-38-60.sslip.io/api")!)
    }

    func restore() async {
        phase = .restoring
        error = nil
        do {
            user = try await client.restore()
            phase = user == nil ? .signedOut : .signedIn
        } catch {
            self.error = error.localizedDescription
            phase = .unavailable
        }
    }

    func login(login: String, password: String) async {
        guard !working else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            user = try await client.login(login: login, password: password)
            phase = .signedIn
        } catch let error as APIError where error.code == "CAPTCHA_REQUIRED" {
            self.error = "Сервер запросил CAPTCHA. В этой предварительной сборке проверка ещё не подключена. Повторите вход позже."
        } catch { self.error = error.localizedDescription }
    }

    func logout() async {
        working = true
        defer { working = false }
        do { try await client.logout() }
        catch { /* Local tokens were cleared before the server request. */ }
        user = nil
        error = nil
        phase = .signedOut
    }
}
