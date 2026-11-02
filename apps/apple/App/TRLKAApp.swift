import SwiftUI
import TRLKACore

@main
struct TRLKAApp: App {
    @State private var account = AccountStore()

    var body: some Scene {
        WindowGroup {
            RootView(account: account)
                .tint(Brand.accent)
                .preferredColorScheme(.dark)
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

enum Brand {
    static let accent = Color(red: 141.0 / 255, green: 166.0 / 255, blue: 220.0 / 255)
    static let online = Color(red: 85.0 / 255, green: 230.0 / 255, blue: 165.0 / 255)
    static let blue = Color(red: 75.0 / 255, green: 127.0 / 255, blue: 1)
    static let background = Color(red: 2.0 / 255, green: 9.0 / 255, blue: 20.0 / 255)
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
