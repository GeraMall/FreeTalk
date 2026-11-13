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
    private var pendingTheme = false
    private var failedSync: Bool?

    func refresh(user: String?, client: AccountClient) async {
        if owner != user {
            revision += 1
            owner = user
            syncEnabled = false
            saving = false
            failedSync = nil
            pendingTheme = false
            error = nil
        }
        guard let user, !saving else { return }
        if pendingTheme {
            await save(true, client: client)
            return
        }
        revision += 1
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
        if syncEnabled { pendingTheme = true; await save(true, client: client) }
    }

    func retry(client: AccountClient) async {
        if let failedSync { await save(failedSync, client: client) }
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
            if ticket == revision { syncEnabled = enabled; pendingTheme = false; failedSync = nil }
        } catch {
            if ticket == revision { self.error = error.localizedDescription; failedSync = enabled }
        }
    }
}

struct AppearancePage: View {
    @AppStorage("trlka.language") private var language = "ru"
    let account: AccountStore
    var body: some View {
        let settings = account.appearance
        Form {
            Picker("Язык программы", selection: $language) {
                Text(verbatim: "Русский").tag("ru")
                Text(verbatim: "English").tag("en")
                Text(verbatim: "简体中文").tag("zh-CN")
                Text(verbatim: "Қазақша").tag("kk")
                Text(verbatim: "Беларуская").tag("be")
                Text(verbatim: "ქართული").tag("ka")
                Text(verbatim: "Español").tag("es")
            }
            Picker("Тема оформления", selection: Binding(get: { settings.theme }, set: { new in
                Task { await settings.choose(new, client: account.client) }
            })) {
                Text(verbatim: "TRLKA").tag("default")
                Text("Светлая").tag("light")
                Text("Чёрная").tag("black")
            }
            Toggle("Синхронизировать тему", isOn: Binding(get: { settings.syncEnabled }, set: { new in
                Task { await settings.save(new, client: account.client) }
            }))
            if let error = settings.error {
                Text(error).foregroundStyle(.red)
                Button("Повторить") { Task { await settings.retry(client: account.client) } }
            }
        }.disabled(settings.saving).navigationTitle("Интерфейс")
    }
}
