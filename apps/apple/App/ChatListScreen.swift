import SwiftUI
import TRLKACore

struct ChatListScreen: View {
    let account: AccountStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var chats: [Chat] = []
    @State private var search = ""
    @State private var error: String?
    @State private var loading = true
    @State private var creating = false
    @State private var created: Chat?
    @State private var joining = false
    @State private var code = ""
    private var filtered: [Chat] { chats.filter { search.isEmpty || $0.name(currentUserID: account.user?.id).localizedCaseInsensitiveContains(search) } }

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("Чаты").font(.system(size: 28, weight: .bold))
                Spacer()
                Button { creating = true } label: { Image(systemName: "plus").font(.system(size: 22)).frame(width: 44, height: 44).trlkaPanel(14) }
                    .buttonStyle(.plain).accessibilityLabel("Создать чат")
            }.padding(.horizontal, 16)
            HStack(spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
                    TextField("Поиск по чатам", text: $search).textFieldStyle(.plain).font(.system(size: 16))
                }.padding(14).trlkaPanel(14)
                Button { joining = true } label: { Image(systemName: "link").frame(width: 46, height: 47).trlkaPanel(14) }
                    .buttonStyle(.plain).accessibilityLabel("Войти в комнату по приглашению")
            }.padding(.horizontal, 16)
            if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal, 16) }
            List(filtered) { chat in
                NavigationLink(value: chat) {
                    HStack(spacing: 13) {
                        ProfileAvatar(name: chat.name(currentUserID: account.user?.id), url: chat.avatar(currentUserID: account.user?.id), client: account.client, size: 48)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(chat.name(currentUserID: account.user?.id)).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                                Spacer(minLength: 2)
                                if let date = chat.lastMessageAt.flatMap(WireDate.parse) {
                                    Text(date, style: .time).font(.system(size: 10)).foregroundStyle(Brand.muted)
                                }
                            }
                            Text(chat.lastMessage ?? "Нет сообщений").font(.system(size: 13)).foregroundStyle(Brand.muted).lineLimit(1)
                        }
                    }.padding(.vertical, 11)
                }
                .listRowBackground(Brand.background)
                .accessibilityIdentifier("chat.row.\(chat.id)")
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 12))
            }
            .listStyle(.plain).scrollContentBackground(.hidden)
            .refreshable { await load() }
            .overlay {
                if loading && chats.isEmpty { ProgressView() }
                else if filtered.isEmpty { ContentUnavailableView("Нет чатов", systemImage: "bubble.left.and.bubble.right", description: Text("Нажмите +, чтобы начать разговор с друзьями.")) }
            }
        }.padding(.top, 12)
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            repeat { await load(); do { try await Task.sleep(for: .seconds(8)) } catch { return } } while !Task.isCancelled
        }
        .task(id: account.revision) { await load() }
        .sheet(isPresented: $creating) { NewChatScreen(account: account) { created = $0; creating = false } }
        .navigationDestination(item: $created) { ConversationView(chat: $0, account: account) }
        .alert("Войти в комнату", isPresented: $joining) {
            TextField("Код или ссылка", text: $code)
            Button("Войти") { if let user = account.user { Task { await account.calls.start(user: user, join: code) } } }
            Button("Отмена", role: .cancel) {}
        }
    }
    private func load() async {
        defer { loading = false }
        do { let result = try await account.client.chats(); try Task.checkCancellation(); chats = result; error = nil }
        catch is CancellationError {} catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

extension Chat {
    func avatar(currentUserID: String?) -> String? { members.first(where: { $0.id != currentUserID })?.avatarUrl }
}

struct NewChatScreen: View {
    let account: AccountStore
    let created: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var friends: [Friend] = []
    @State private var selected: Set<String> = []
    @State private var title = ""
    @State private var error: String?
    @State private var working = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextField("Название группы (необязательно)", text: $title).textFieldStyle(.roundedBorder).padding(.horizontal)
                List(friends) { friend in
                    Button {
                        if selected.contains(friend.id) { selected.remove(friend.id) } else if selected.count < 7 { selected.insert(friend.id) }
                    } label: {
                        HStack {
                            ProfileAvatar(name: friend.display_name, url: friend.avatarUrl, client: account.client)
                            Text(friend.display_name).foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: selected.contains(friend.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(Brand.cyan)
                        }
                    }
                }.listStyle(.plain)
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
                Button("Создать чат") {
                    working = true
                    Task {
                        defer { working = false }
                        do { let chat = try await account.client.createChat(memberIDs: Array(selected), title: title.isEmpty ? nil : title); dismiss(); created(chat) }
                        catch { self.error = error.localizedDescription }
                    }
                }.buttonStyle(PrimaryButton()).disabled(selected.isEmpty || working).padding()
            }
            .navigationTitle("Новый чат")
            .toolbar { ToolbarItem { Button("Отмена") { dismiss() } } }
            .task { do { friends = try await account.client.friends() } catch { self.error = error.localizedDescription } }
        }.presentationDetents([.large])
    }
}
