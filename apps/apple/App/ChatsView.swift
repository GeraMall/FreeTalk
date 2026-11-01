import SwiftUI
import TRLKACore

struct ChatsView: View {
    let account: AccountStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var chats: [Chat] = []
    @State private var search = ""
    @State private var selected: Chat?
    @State private var error: String?
    @State private var loading = true
    @State private var profile = false

    private var filtered: [Chat] {
        chats.filter { search.isEmpty || $0.name(currentUserID: account.user?.id).localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationSplitView {
            List(filtered, selection: $selected) { chat in
                NavigationLink(value: chat) {
                    HStack(spacing: 12) {
                        Avatar(name: chat.name(currentUserID: account.user?.id))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(chat.name(currentUserID: account.user?.id)).font(.headline).lineLimit(1)
                            Text(chat.lastMessage ?? "Нет сообщений").font(.subheadline)
                                .foregroundStyle(.secondary).lineLimit(1)
                        }
                    }.padding(.vertical, 5)
                }
            }
            .navigationTitle("Чаты")
            .searchable(text: $search, prompt: "Поиск по чатам")
            .refreshable { await load() }
            .toolbar {
                ToolbarItem {
                    Button { profile = true } label: { Image(systemName: "person.crop.circle") }
                        .accessibilityLabel("Профиль и настройки")
                }
            }
            .overlay {
                if loading && chats.isEmpty { ProgressView() }
                else if chats.isEmpty && error == nil {
                    ContentUnavailableView("Пока нет чатов", systemImage: "bubble.left.and.bubble.right",
                                           description: Text("Здесь появятся чаты твоего аккаунта TRLKA."))
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let error {
                    HStack {
                        Text(error).font(.caption)
                        Button("Повторить") { Task { await load() } }
                    }.padding().background(.regularMaterial)
                }
            }
        } detail: {
            if let selected { ConversationView(chat: selected, account: account).id(selected.id) }
            else { ContentUnavailableView("Твои разговоры", systemImage: "bubble.left.and.bubble.right") }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            repeat {
                await load()
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
            } while !Task.isCancelled
        }
        .sheet(isPresented: $profile) { ProfileView(account: account) }
    }

    private func load() async {
        defer { loading = false }
        do {
            let result = try await account.client.chats()
            try Task.checkCancellation()
            chats = result
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

struct Avatar: View {
    let name: String
    var body: some View {
        Text(String(name.prefix(1)).uppercased()).font(.headline)
            .frame(width: 42, height: 42)
            .background(Brand.gradient.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityHidden(true)
    }
}
