import SwiftUI
import TRLKACore

struct VisibleMessageIDs: PreferenceKey {
    static var defaultValue: Set<String> = []
    static func reduce(value: inout Set<String>, nextValue: () -> Set<String>) { value.formUnion(nextValue()) }
}

struct MessageForwardSheet: View {
    let account: AccountStore
    let message: Message
    @Environment(\.dismiss) private var dismiss
    @State private var chats: [Chat] = []
    @State private var search = ""
    @State private var working = false
    @State private var error: String?
    private var matches: [Chat] {
        chats.filter { !$0.isService && $0.isSaved != true && (search.isEmpty || $0.name(currentUserID: account.user?.id).localizedCaseInsensitiveContains(search)) }
            .sorted { ($0.lastMessageAt ?? "") > ($1.lastMessageAt ?? "") }
    }
    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red).font(.callout) }
                if search.isEmpty || "Избранное".localizedCaseInsensitiveContains(search) {
                    Button { forward(nil) } label: { Label("Избранное", systemImage: "bookmark.fill") }
                }
                ForEach(matches) { chat in
                    Button { forward(chat) } label: {
                        HStack {
                            ProfileAvatar(name: chat.name(currentUserID: account.user?.id), url: chat.avatar(currentUserID: account.user?.id), client: account.client, size: 32)
                            Text(chat.name(currentUserID: account.user?.id)).lineLimit(1)
                        }
                    }
                }
            }.disabled(working).searchable(text: $search, prompt: "Найти чат")
            .navigationTitle("Переслать сообщение")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task { do { chats = try await account.client.chats() } catch { if !Task.isCancelled { self.error = error.localizedDescription } } }
        }
    }
    private func forward(_ target: Chat?) {
        guard !working else { return }
        working = true
        Task {
            defer { working = false }
            do {
                let id: String
                if let target { id = target.id }
                else if let saved = chats.first(where: { $0.isSaved == true }) { id = saved.id }
                else { id = try await account.client.savedChat().id }
                try await account.client.forward(messageID: message.id, to: id)
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct MessageReadersSheet: View {
    let account: AccountStore
    let chat: Chat
    let message: Message
    @Environment(\.dismiss) private var dismiss
    @State private var readers: [MessageReader] = []
    @State private var loading = true
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView() }
                else if let error { Text(error).font(.callout) }
                else if readers.isEmpty { Text("Пока никто не просмотрел").foregroundStyle(Brand.muted) }
                else {
                    List(readers) { reader in
                        HStack {
                            ProfileAvatar(name: reader.name, url: reader.avatarUrl, client: account.client, size: 32)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(chat.type == "direct" ? "Просмотрено" : reader.name)
                                if let date = WireDate.parse(reader.readAt) { Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Brand.muted) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Просмотры")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Готово") { dismiss() } } }
            .task {
                do { readers = try await account.client.readers(chatID: chat.id, messageID: message.id) }
                catch { if !Task.isCancelled { self.error = error.localizedDescription } }
                loading = false
            }
        }.presentationDetents([.medium])
    }
}
