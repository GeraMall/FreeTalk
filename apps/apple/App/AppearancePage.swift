import SwiftUI
import TRLKACore

#if os(iOS)
enum MobileNavigation {
    static let showQRKey = "trlka.showBottomQR"
}
#endif

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
    #if os(iOS)
    @AppStorage(MobileNavigation.showQRKey) private var showQR = true
    #endif
    let account: AccountStore
    var body: some View {
        let settings = account.appearance
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Picker("Язык программы", selection: $language) {
                        Text(verbatim: "Русский").tag("ru")
                        Text(verbatim: "English").tag("en")
                        Text(verbatim: "简体中文").tag("zh-CN")
                        Text(verbatim: "Қазақша").tag("kk")
                        Text(verbatim: "Беларуская").tag("be")
                        Text(verbatim: "ქართული").tag("ka")
                        Text(verbatim: "Español").tag("es")
                    }.pickerStyle(.menu)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    Rectangle().fill(Brand.webStroke).frame(height: 0.5)
                    Picker("Тема оформления", selection: Binding(get: { settings.theme }, set: { new in
                        Task { await settings.choose(new, client: account.client) }
                    })) {
                        Text(verbatim: "TRLKA").tag("default")
                        Text("Светлая").tag("light")
                        Text("Чёрная").tag("black")
                    }.pickerStyle(.menu)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .disabled(settings.saving)
                    Rectangle().fill(Brand.webStroke).frame(height: 0.5)
                    Toggle("Синхронизировать тему", isOn: Binding(get: { settings.syncEnabled }, set: { new in
                        Task { await settings.save(new, client: account.client) }
                    })).frame(minHeight: 48).disabled(settings.saving)
                    if let error = settings.error {
                        Text(error).foregroundStyle(.red).font(.footnote)
                        Button("Повторить") { Task { await settings.retry(client: account.client) } }
                            .frame(minHeight: 44)
                    }
                }.padding(.horizontal, 14).padding(.vertical, 4).webPanel(16)
                #if os(iOS)
                Toggle(isOn: $showQR) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Кнопка QR в нижней панели").font(.subheadline.weight(.semibold))
                        Text("Вход по QR останется доступен в настройках.").font(.caption).foregroundStyle(Brand.muted)
                    }.fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("settings.qr-shortcut")
                .frame(minHeight: 52)
                .padding(.horizontal, 14).padding(.vertical, 6).webPanel(16)
                #endif
            }
            .padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }
        .background(Brand.webBackground)
    }
}
