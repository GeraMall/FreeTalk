import SwiftUI
import TRLKACore
import AVFoundation

@MainActor @Observable
final class AccountStore {
    enum Phase { case restoring, signedOut, signedIn, unavailable }
    var phase: Phase = .restoring
    var user: AccountUser?
    var error: String?
    var working = false
    var needsEmailVerification = false
    let appearance = AppearanceSettings()
    let client: AccountClient
    let calls: CallController
    var incoming: IncomingCall?
    var revision = 0
    var chatListRevision = 0
    var chatRevisions: [String: Int] = [:]
    var socketRevision = 0
    var drafts: [String: String] = [:]
    struct Typist {
        let name: String
        let expiry: Date
    }
    private(set) var typists: [String: [String: Typist]] = [:]
    private let realtime = SocketChannel()
    private var expiryTask: Task<Void, Never>?
    private var ringtone: AVAudioPlayer?

    init() {
        // Build configuration only; never accept server addresses from deep links.
        let endpoint = Bundle.main.object(forInfoDictionaryKey: "TRLKAAPIBaseURL") as? String
        #if DEBUG
        if PreviewFixtures.mode != nil {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [PreviewProtocol.self]
            client = try! AccountClient(transport: URLSession(configuration: configuration), vault: PreviewVault())
        } else {
            client = try! AccountClient(baseURL: endpoint.flatMap(URL.init(string:)) ?? AccountClient.primaryURL, reserve: AccountClient.reserveURL)
        }
        #else
        client = try! AccountClient(baseURL: endpoint.flatMap(URL.init(string:)) ?? AccountClient.primaryURL, reserve: AccountClient.reserveURL)
        #endif
        calls = CallController(client: client)
        realtime.onMessage = { [weak self] in self?.receive($0) }
    }

    func restore() async {
        phase = .restoring
        error = nil
        do {
            user = try await client.restore()
            #if DEBUG
            if PreviewFixtures.mode == "login" { user = nil }
            #endif
            phase = user == nil ? .signedOut : .signedIn
            if user != nil { await startRealtime() }
        } catch {
            self.error = error.localizedDescription
            phase = .unavailable
        }
    }

    func login(login: String, password: String) async {
        guard !working else { return }
        working = true
        error = nil
        needsEmailVerification = false
        defer { working = false }
        do {
            user = try await client.login(login: login, password: password)
            phase = .signedIn
            await startRealtime()
        } catch let error as APIError where error.code == "EMAIL_NOT_VERIFIED" {
            needsEmailVerification = true
        } catch let error as APIError where error.code == "CAPTCHA_REQUIRED" {
            self.error = "Сервер запросил CAPTCHA. В этой предварительной сборке проверка ещё не подключена. Повторите вход позже."
        } catch { self.error = error.localizedDescription }
    }

    func verifyEmail(_ email: String, code: String) async throws {
        user = try await client.verifyEmail(email: email, code: code)
        error = nil
        needsEmailVerification = false
        phase = .signedIn
        await startRealtime()
    }

    func logout() async {
        working = true
        defer { working = false }
        calls.end(); realtime.stop(); clearIncoming()
        drafts.removeAll(); chatRevisions.removeAll(); typists.removeAll()
        do { try await client.logout() }
        catch { /* Local tokens were cleared before the server request. */ }
        user = nil
        error = nil
        phase = .signedOut
    }

    private func startRealtime() async {
        #if DEBUG
        if PreviewFixtures.mode != nil {
            if PreviewFixtures.mode == "call" || PreviewFixtures.mode == "call-video" || PreviewFixtures.mode == "minimized" {
                calls.roomID = "ABCDEFGHJKLM"; calls.selfID = PreviewFixtures.userID; calls.title = "Комната с друзьями"
                calls.participants = PreviewFixtures.participants; calls.phase = .connected; calls.presented = PreviewFixtures.mode != "minimized"
                calls.tablet = ["revision": 1, "open": true, "region": "RU", "canPlayPoker": false]
                if PreviewFixtures.mode == "call-video" { calls.installPreviewCamera() }
            }
            return
        }
        #endif
        realtime.start(url: { [client] in
            try await client.readyEndpoint()
            return await client.realtimeURL()
        }, roomHeartbeat: false) { [client] in
            ["type": "authenticate", "token": try await client.realtimeToken()]
        }
    }

    private func receive(_ message: [String: Any]) {
        let type = message["type"] as? String
        if type == "ready" { typists.removeAll(); realtime.send(["type": "presence", "status": "online"]); revision += 1; chatListRevision += 1; socketRevision += 1; return }
        if type == "incoming-call", let data = try? JSONSerialization.data(withJSONObject: message),
           let invitation = try? JSONDecoder().decode(IncomingCall.self, from: data),
           let until = WireDate.parse(invitation.expiresAt), until > Date() {
            clearIncoming(); incoming = invitation
            if !calls.active, let url = Bundle.main.url(forResource: "incoming-call", withExtension: "wav") {
                ringtone = try? AVAudioPlayer(contentsOf: url); ringtone?.numberOfLoops = -1; ringtone?.play()
            }
            expiryTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(min(120, until.timeIntervalSinceNow))) } catch { return }
                self?.clearIncoming()
            }
        }
        if type == "call-invitation-resolved", message["invitationId"] as? String == incoming?.invitationId { clearIncoming() }
        if type == "call-invitation-resolved", let id = message["inviteeId"] as? String,
           ["declined", "missed"].contains(message["status"] as? String ?? "") { calls.removeWaiting(id) }
        switch type {
        case "chat-typing":
            guard let chatID = message["chatId"] as? String, let userID = message["userId"] as? String,
                  userID != user?.id, let name = message["name"] as? String,
                  let millis = message["expiresAt"] as? Double else { return }
            let now = Date()
            var current = typists[chatID, default: [:]].filter { $0.value.expiry > now }
            current[userID] = millis > 0 ? Typist(name: name, expiry: now.addingTimeInterval(5)) : nil
            typists[chatID] = current.isEmpty ? nil : current
        case "chat-removed":
            if let id = message["chatId"] as? String { drafts[id] = nil; chatRevisions[id, default: 0] += 1 }
            chatListRevision += 1
        case "chat-updated", "message-created", "message-updated", "message-deleted", "message-pin-updated", "message-reactions-updated":
            if let id = message["chatId"] as? String { chatRevisions[id, default: 0] += 1 }
            if type != "message-pin-updated" && type != "message-reactions-updated" { chatListRevision += 1 }
        case "friends-updated", "presence-updated", "call-invitation-resolved", "incoming-call": revision += 1
        default: break
        }
    }

    private func clearIncoming() {
        expiryTask?.cancel(); expiryTask = nil; incoming = nil; ringtone?.stop(); ringtone = nil
    }

    func answerIncoming(accept: Bool) async {
        guard let incoming, let user else { return }
        if accept && calls.active { error = "Сначала завершите текущий звонок."; return }
        clearIncoming()
        do {
            let result = try await client.respond(invitationID: incoming.invitationId, accept: accept)
            if accept { await calls.start(user: user, join: result.roomId) }
        } catch { self.error = error.localizedDescription }
    }
}
