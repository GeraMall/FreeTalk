import SwiftUI
import TRLKACore

@main
struct TRLKAApp: App {
    @State private var account = AccountStore()

    var body: some Scene {
        WindowGroup {
            RootView(account: account)
                .tint(Brand.cyan)
                .preferredColorScheme(.dark)
                #if os(macOS)
                .frame(minWidth: 720, minHeight: 500)
                #endif
        }
        #if os(macOS)
        Settings {
            ProfileView(account: account).frame(width: 420, height: 350)
        }
        #endif
    }
}

enum Brand {
    static let cyan = Color(red: 0.24, green: 0.89, blue: 0.93)
    static let blue = Color(red: 0.25, green: 0.49, blue: 1)
    static let background = Color(red: 0.02, green: 0.05, blue: 0.09)
    static let gradient = LinearGradient(colors: [cyan, blue], startPoint: .leading, endPoint: .trailing)
}

struct RootView: View {
    let account: AccountStore
    var body: some View {
        Group {
            switch account.phase {
            case .restoring: ProgressView("Восстанавливаем вход…")
            case .signedOut: LoginView(account: account)
            case .signedIn: ChatsView(account: account)
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
