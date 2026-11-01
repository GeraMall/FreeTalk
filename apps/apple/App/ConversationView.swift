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

    var body: some View {
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
                                Text(message.preview).textSelection(.enabled)
                            }
                            .padding(12)
                            .background(mine ? Brand.cyan.opacity(0.14) : Color.white.opacity(0.06),
                                        in: RoundedRectangle(cornerRadius: 16))
                            if !mine { Spacer(minLength: 36) }
                        }.id(message.id)
                    }
                }.padding()
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: messages.last?.id) {
                if !loadingOlder { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(messages.last?.id, anchor: .bottom) } }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let error { Text(error).font(.caption).foregroundStyle(.red) }
                    HStack(alignment: .bottom, spacing: 12) {
                        TextField("Сообщение", text: $draft, axis: .vertical)
                            .lineLimit(1...5).textFieldStyle(.roundedBorder)
                        Button { Task { await send() } } label: {
                            Image(systemName: "arrow.up").font(.headline)
                                .frame(width: 42, height: 42).background(Brand.gradient, in: Circle())
                                .foregroundStyle(.black)
                        }
                        .buttonStyle(.plain)
                        .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("Отправить сообщение")
                    }
                }.padding().background(.regularMaterial)
            }
        }
        .navigationTitle(chat.name(currentUserID: account.user?.id))
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            repeat {
                await load()
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
            } while !Task.isCancelled
        }
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
