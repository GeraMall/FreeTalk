import SwiftUI
import TRLKACore

@MainActor @Observable
final class AppearanceSettings {
    private(set) var theme = UserDefaults.standard.string(forKey: "trlka.theme") ?? "default"
    private(set) var syncEnabled = false
    private(set) var saving = false
    var error: String?
    private var revision = 0
    private var owner: String?

    func refresh(user: String?, client: AccountClient) async {
        if owner != user {
            revision += 1
            owner = user
            syncEnabled = false
            saving = false
            error = nil
        }
        guard let user, !saving else { return }
        let ticket = revision
        do {
            let remote = try await client.appearance()
            guard !Task.isCancelled, owner == user, ticket == revision else { return }
            syncEnabled = remote.syncEnabled
            if remote.syncEnabled { apply(remote.theme) }
        } catch { /* Local appearance remains available offline. */ }
    }

    func choose(_ value: String, client: AccountClient) async {
        guard !saving, value != theme else { return }
        revision += 1
        apply(value)
        if syncEnabled { await save(true, client: client) }
    }

    private func apply(_ value: String) {
        guard ["default", "light", "black"].contains(value) else { return }
        theme = value
        UserDefaults.standard.set(value, forKey: "trlka.theme")
    }

    func save(_ enabled: Bool, client: AccountClient) async {
        guard owner != nil, !saving else { return }
        revision += 1
        let ticket = revision
        saving = true
        error = nil
        defer { if ticket == revision { saving = false } }
        do {
            try await client.setAppearance(theme: theme, syncEnabled: enabled)
            if ticket == revision { syncEnabled = enabled }
        } catch {
            if ticket == revision { self.error = error.localizedDescription }
        }
    }
}

struct AppearancePage: View {
    let account: AccountStore
    var body: some View {
        let settings = account.appearance
        Form {
            Picker("Тема", selection: Binding(get: { settings.theme }, set: { new in
                Task { await settings.choose(new, client: account.client) }
            })) {
                Text("Основная").tag("default")
                Text("Светлая").tag("light")
                Text("Чёрная").tag("black")
            }
            Toggle("Синхронизировать тему между устройствами", isOn: Binding(get: { settings.syncEnabled }, set: { new in
                Task { await settings.save(new, client: account.client) }
            }))
            if let error = settings.error {
                Text(error).foregroundStyle(.red)
            }
        }.disabled(settings.saving).navigationTitle("Интерфейс")
    }
}
