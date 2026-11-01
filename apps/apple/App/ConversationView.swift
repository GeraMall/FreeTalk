import SwiftUI
import TRLKACore

struct ConversationView: View {
    let chat: Chat
    let account: AccountStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var hasMore = false
    @State private var sending = false
    @State private var loadingOlder = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
        HStack(spacing: 12) {
            Button { dismiss() } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 34, height: 42) }
                .buttonStyle(CompactControlStyle()).accessibilityLabel("Назад к чатам").accessibilityIdentifier("chat.back")
            ProfileAvatar(name: chat.name(currentUserID: account.user?.id), url: chat.avatar(currentUserID: account.user?.id), client: account.client, size: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(chat.name(currentUserID: account.user?.id)).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                Text(chat.type == "direct" ? "Личная переписка" : "Участников: \(chat.members.count)").font(.system(size: 11)).foregroundStyle(Brand.muted)
            }
            Spacer(minLength: 4)
            Button {
                if let user = account.user { Task { await account.calls.start(user: user, chat: chat) } }
            } label: { Image(systemName: "phone").font(.system(size: 20)).frame(width: 42, height: 42) }
                .buttonStyle(CompactControlStyle()).disabled(account.calls.busy).accessibilityLabel("Позвонить").accessibilityIdentifier("chat.call")
        }.padding(.horizontal, 10).padding(.vertical, 8)
            .overlay(alignment: .bottom) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if hasMore {
                        Button("Загрузить предыдущие") { Task { await load(older: true) } }
                            .disabled(loadingOlder)
                    }
                    ForEach(messages) { message in
                        let mine = message.senderID == account.user?.id
                        HStack {
                            if mine { Spacer(minLength: 36) }
                            VStack(alignment: .leading, spacing: 5) {
                                if !mine, let name = message.displayName {
                                    Text(name).font(.caption.bold()).foregroundStyle(Brand.cyan)
                                }
                                if message.kind == "call" {
                                    Label(message.metadata?.ended == true ? "Звонок завершён" : "Голосовой звонок", systemImage: "phone")
                                        .font(.subheadline.weight(.semibold))
                                    if let code = message.metadata?.roomId, message.metadata?.ended != true {
                                        Button("Присоединиться") {
                                            if let user = account.user { Task { await account.calls.start(user: user, join: code) } }
                                        }.buttonStyle(.bordered)
                                    }
                                } else { Text(message.preview).font(.system(size: 15)).textSelection(.enabled) }
                                if let date = WireDate.parse(message.createdAt) {
                                    Text(date, style: .time).font(.system(size: 10)).foregroundStyle(Brand.muted).frame(maxWidth: .infinity, alignment: .trailing)
                                }
                            }
                            .padding(12)
                            .background(mine ? Brand.cyan.opacity(0.12) : Brand.surface.opacity(0.6),
                                        in: RoundedRectangle(cornerRadius: 16))
                            if !mine { Spacer(minLength: 36) }
                        }.id(message.id)
                    }
                }.padding()
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .accessibilityIdentifier("chat.messages")
            .onChange(of: messages.last?.id) {
                if !loadingOlder { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo(messages.last?.id, anchor: .bottom) } }
            }
        }
        composer
        }
        .background(Brand.background)
        .navigationTitle(chat.name(currentUserID: account.user?.id))
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .task(id: account.revision) { await load() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            repeat {
                await load()
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
            } while !Task.isCancelled
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Сообщение", text: $draft, axis: .vertical)
                    .lineLimit(1...5).textFieldStyle(.plain).font(.system(size: 16)).padding(13).trlkaPanel(14)
                    .accessibilityIdentifier("chat.composer")
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up").font(.headline)
                        .frame(width: 42, height: 42).background(Brand.gradient, in: Circle()).foregroundStyle(.black)
                }.buttonStyle(.plain)
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Отправить сообщение")
                    .accessibilityIdentifier("chat.send")
            }
        }.padding(12).background(Brand.background)
    }

    private func load(older: Bool = false) async {
        if older { loadingOlder = true }
        defer { if older { loadingOlder = false } }
        do {
            let page = try await account.client.messages(chatID: chat.id, before: older ? messages.first?.createdAt : nil)
            try Task.checkCancellation()
            if older {
                let existing = Set(messages.map(\.id))
                messages.insert(contentsOf: page.messages.filter { !existing.contains($0.id) }, at: 0)
                hasMore = page.hasMore
            } else {
                // Retain loaded history while refreshing the latest page.
                let incoming = Set(page.messages.map(\.id))
                let oldest = page.messages.first?.createdAt
                let previous = messages.filter { message in
                    !incoming.contains(message.id) && (oldest.map { message.createdAt < $0 } ?? false)
                }
                if messages.count <= 100 { messages = page.messages; hasMore = page.hasMore }
                else {
                    messages = previous + page.messages
                }
            }
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    private func send() async {
        guard !sending else { return }
        let text = draft
        sending = true
        defer { sending = false }
        do {
            let message = try await account.client.send(chatID: chat.id, text: text)
            if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
            if draft == text { draft = "" }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
