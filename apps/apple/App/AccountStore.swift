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
    private var generation = 0

    init() {
        // A fixed HTTPS origin; never accept a server address from a deep link.
        client = try! AccountClient()
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
            generation += 1
            phase = .signedIn
        } catch let error as APIError where error.code == "CAPTCHA_REQUIRED" {
            self.error = "Сервер запросил CAPTCHA. В этой предварительной сборке проверка ещё не подключена. Повторите вход позже."
        } catch { self.error = error.localizedDescription }
    }

    func logout() async {
        generation += 1
        working = true
        defer { working = false }
        do { try await client.logout() }
        catch { /* Local tokens were cleared before the server request. */ }
        user = nil
        error = nil
        phase = .signedOut
    }
}
