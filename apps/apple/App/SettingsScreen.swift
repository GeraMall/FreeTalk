import SwiftUI

struct ProfileView: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false
    @State private var editing = false
    @State private var name = ""
    @State private var bio = ""
    @State private var error: String?
    @State private var working = false
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 14) {
                        ProfileCover(url: account.user?.coverUrl, client: account.client)
                            .overlay(alignment: .bottomLeading) {
                                ProfileAvatar(name: account.user?.displayName ?? "", url: account.user?.avatarUrl, client: account.client, size: 72).offset(x: 16, y: 24)
                            }.padding(.bottom, 24)
                        Text(account.user?.displayName ?? "").font(.system(size: 24, weight: .bold)).padding(.horizontal, 16)
                        Text("@\(account.user?.username ?? "") · В сети").font(.caption).foregroundStyle(Brand.accent).padding(.horizontal, 16)
                        if let bio = account.user?.bio, !bio.isEmpty { Text(bio).font(.subheadline).padding(.horizontal, 16) }
                    }.padding(.bottom, 18).trlkaPanel(20)
                    Button {
                        name = account.user?.displayName ?? ""; bio = account.user?.bio ?? ""; editing = true
                    } label: { settingsRow("Редактировать профиль", icon: "pencil", description: "Имя и информация о себе") }
                        .buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 18) {
                        Label("Видео и звук", systemImage: "video").font(.headline)
                        Toggle("Зеркалить свою камеру", isOn: $mirrorSelf).font(.subheadline).tint(Brand.accent)
                        Text("Настройка меняет только ваш предпросмотр. Собеседники видят обычное изображение.").font(.caption).foregroundStyle(Brand.muted)
                    }.padding(18).trlkaPanel()
                    VStack(alignment: .leading, spacing: 10) {
                        Label("О приложении", systemImage: "info.circle").font(.headline)
                        Text("TRLKA 0.2.1 · нативная beta").font(.subheadline).foregroundStyle(Brand.muted)
                        Text("Входящие звонки доступны, пока приложение открыто. Уведомления через Apple Push пока не подключены.").font(.caption).foregroundStyle(Brand.muted)
                    }.padding(18).trlkaPanel()
                    Button("Выйти из аккаунта", role: .destructive) { confirmLogout = true }
                        .frame(maxWidth: .infinity).padding(14).trlkaPanel(14).disabled(account.working)
                }.padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
            }
            .background(Brand.background)
            .navigationTitle("Настройки")
            .toolbar { ToolbarItem { Button("Готово") { dismiss() }.accessibilityIdentifier("settings.done") } }
            .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { Task { await account.logout(); dismiss() } }
            }
            .sheet(isPresented: $editing) {
                NavigationStack {
                    Form {
                        TextField("Имя", text: $name)
                        TextField("О себе", text: $bio, axis: .vertical).lineLimit(3...6)
                        if let error { Text(error).foregroundStyle(.red) }
                    }
                    .navigationTitle("Профиль")
                    .toolbar {
                        ToolbarItem { Button("Отмена") { editing = false } }
                        ToolbarItem {
                            Button("Сохранить") {
                                working = true
                                Task {
                                    defer { working = false }
                                    do { account.user = try await account.client.updateProfile(displayName: name, bio: bio); editing = false }
                                    catch { self.error = error.localizedDescription }
                                }
                            }.disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }.presentationDetents([.medium, .large])
            }
        }.presentationDetents([.large])
    }
    private func settingsRow(_ title: String, icon: String, description: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).foregroundStyle(Brand.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 5) { Text(title).font(.headline); Text(description).font(.caption).foregroundStyle(Brand.muted) }
            Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Brand.muted)
        }.padding(18).trlkaPanel()
    }
}
