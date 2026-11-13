import SwiftUI
import TRLKACore

@main
struct TRLKAApp: App {
    @AppStorage("trlka.language") private var language = "ru"
    @State private var account = AccountStore()

    @Environment(\.scenePhase) private var scenePhase
    private var theme: String { account.phase == .signedIn ? account.appearance.theme : "default" }

    var body: some Scene {
        WindowGroup {
            RootView(account: account)
                .tint(Brand.accent)
                .environment(\.locale, Locale(identifier: language))
                .preferredColorScheme(theme == "light" ? .light : .dark)
                .onChange(of: theme, initial: true) { _, value in Brand.palette.theme = value }
                .task(id: account.user?.id) { await account.appearance.refresh(user: account.user?.id, client: account.client) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await account.appearance.refresh(user: account.user?.id, client: account.client) } }
                }
                #if os(macOS)
                .frame(minWidth: 720, minHeight: 500)
                #endif
        }
        #if os(macOS)
        Settings {
            ProfileView(account: account).tint(Brand.accent).frame(width: 420, height: 350)
        }
        #endif
    }
}

@Observable final class BrandPalette {
    var theme = "default"
    func color(_ dark: UInt32, _ light: UInt32, _ black: UInt32) -> Color {
        let rgb = theme == "light" ? light : theme == "black" ? black : dark
        return Color(red: Double(rgb >> 16) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}

enum Brand {
    static let palette = BrandPalette()
    static var accent: Color { palette.color(0x8da6dc, 0x365fa6, 0xa5baf3) }
    static var online: Color { palette.color(0x55e6a5, 0x137a4c, 0x55e6a5) }
    static let blue = Color(red: 75.0 / 255, green: 127.0 / 255, blue: 1)
    static var background: Color { palette.color(0x020914, 0xf5f7fb, 0x000000) }
    static let gradient = LinearGradient(colors: [accent, blue], startPoint: .leading, endPoint: .trailing)
}

struct RootView: View {
    let account: AccountStore
    var body: some View {
        Group {
            switch account.phase {
            case .restoring: ProgressView("Восстанавливаем вход…")
            case .signedOut: LoginView(account: account)
            case .signedIn: AppShell(account: account)
            case .unavailable:
                ContentUnavailableView {
                    Label("Нет соединения", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(account.error ?? "Проверьте подключение к интернету.")
                } actions: {
                    Button("Повторить") { Task { await account.restore() } }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.background)
        .task { await account.restore() }
    }
}
