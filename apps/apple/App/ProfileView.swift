import SwiftUI

struct ProfileView: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Аккаунт") {
                    if let user = account.user {
                        LabeledContent("Имя", value: user.displayName)
                        LabeledContent("Username", value: "@\(user.username)")
                    }
                }
                Section {
                    Text("Нативная предварительная сборка. Звонки, вложения и push-уведомления пока не включены.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Выйти из аккаунта", role: .destructive) { confirmLogout = true }
                        .disabled(account.working)
                }
            }
            .navigationTitle("Профиль")
            .toolbar { ToolbarItem { Button("Готово") { dismiss() } } }
            .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { Task { await account.logout(); dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
