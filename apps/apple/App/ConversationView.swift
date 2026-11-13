import SwiftUI
import TRLKACore
#if os(iOS)
import PhotosUI
import UniformTypeIdentifiers
#endif

struct ConversationView: View {
    let chat: Chat
    let account: AccountStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var messages: [Message] = []
    private var draft: String {
        get { account.drafts[chat.id] ?? "" }
        nonmutating set { account.drafts[chat.id] = newValue }
    }
    @State private var error: String?
    @State private var hasMore = false
    @State private var sending = false
    @State private var loadingOlder = false
    @State private var replying: Message?
    @State private var editing: Message?
    @State private var displayReaders: Message?
    @State private var editText = ""
    @State private var deleteTarget: Message?
    @State private var forwarding: Message?
    @State private var actionBusy = false
    @State private var lastTypingNotice = Date.distantPast
    @State private var typingSend: Task<Void, Never>?
    @State private var pendingReads: Set<String> = []
    @State private var completedReads: Set<String> = []
    @State private var groupedIDs: Set<String> = []
    @State private var nearBottom = true
    @State private var viewportHeight: CGFloat = 0
    @State private var newMessages = false
    @State private var didScrollToLatest = false
    @State private var loadedHistory = false
    @State private var pageRevision = 0
    #if os(iOS)
    @State private var choosingFile = false
    @State private var photo: PhotosPickerItem?
    #endif
    @State private var profileVisible = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
        HStack(spacing: 12) {
            Button { dismiss() } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44) }
                .buttonStyle(CompactControlStyle()).accessibilityLabel("Назад к чатам").accessibilityIdentifier("chat.back")
            ProfileAvatar(name: chat.name(currentUserID: account.user?.id), url: chat.avatar(currentUserID: account.user?.id), client: account.client, size: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(chat.name(currentUserID: account.user?.id)).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                Text(chat.isSaved == true ? "Личные заметки" : chat.type == "direct" ? "@\(chat.members.first { $0.id != account.user?.id }?.username ?? "")" : "Участников: \(chat.members.count)").font(.system(size: 11)).foregroundStyle(Brand.muted)
            }
            Spacer(minLength: 4)
            if chat.isSaved != true {
            Button {
                if let user = account.user { Task { await account.calls.start(user: user, chat: chat) } }
            } label: { Image(systemName: "phone").font(.system(size: 20)).frame(width: 44, height: 44) }
                .buttonStyle(CompactControlStyle()).disabled(account.calls.busy).accessibilityLabel("Позвонить").accessibilityIdentifier("chat.call")
            Button { profileVisible = true } label: { Image(systemName: "sidebar.right").font(.system(size: 19)).frame(width: 36, height: 44) }
                .buttonStyle(CompactControlStyle()).accessibilityLabel("Показать профиль")
            }
        }.padding(.horizontal, 10).padding(.vertical, 8).background(Brand.webHeader)
            .overlay(alignment: .bottom) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
        GeometryReader { viewport in
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if hasMore {
                        Button("Загрузить предыдущие") { Task { await load(older: true) } }
                            .disabled(loadingOlder)
                    }
                    ForEach(messages) { message in
                        messageRow(message, width: min(viewport.size.width * 0.78, 640)).id(message.id)
                            .background {
                                if scenePhase == .active && message.senderID != nil && message.senderID != account.user?.id && message.metadata?.deleted != true && !completedReads.contains(message.id) {
                                    GeometryReader { proxy in
                                        let frame = proxy.frame(in: .named("message-viewport"))
                                        Color.clear.preference(key: VisibleMessageIDs.self, value: frame.maxY > 0 && frame.minY < viewport.size.height ? [message.id] : [])
                                    }
                                }
                            }
                    }
                    Color.clear.frame(height: 1).id("message-bottom")
                        .background(GeometryReader { geometry in Color.clear.preference(key: MessageBottomKey.self, value: geometry.frame(in: .named("message-viewport")).maxY) })
                }.padding(.horizontal, 12).padding(.vertical, 12)
            }
            .coordinateSpace(name: "message-viewport")
            .background(GeometryReader { geometry in Color.clear.preference(key: MessageViewportKey.self, value: geometry.size.height) })
            .onPreferenceChange(VisibleMessageIDs.self) { visible in
                if scenePhase == .active { pendingReads.formUnion(visible.subtracting(completedReads)) }
            }
            .onPreferenceChange(MessageViewportKey.self) { viewportHeight = $0 }
            .onPreferenceChange(MessageBottomKey.self) { nearBottom = $0 <= viewportHeight + 100; if nearBottom { newMessages = false } }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .accessibilityIdentifier("chat.messages")
            .onChange(of: messages.last?.id) {
                if !loadingOlder {
                    if !didScrollToLatest || nearBottom {
                        proxy.scrollTo("message-bottom", anchor: .bottom)
                        didScrollToLatest = true
                    }
                    else { newMessages = true }
                }
            }
            .overlay(alignment: .bottom) {
                if newMessages {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo("message-bottom", anchor: .bottom) }
                        newMessages = false
                    } label: { Label("Новые сообщения", systemImage: "arrow.down").font(.caption.bold()).padding(.horizontal, 14).padding(.vertical, 9).background(Brand.surface, in: Capsule()).overlay(Capsule().stroke(Brand.accent.opacity(0.5))) }
                        .buttonStyle(CompactControlStyle()).padding(.bottom, 8)
                }
            }
        }
        }
        composer
        }
        .background(Brand.chatCanvas)
        .preference(key: ChatDestinationKey.self, value: true)
        .navigationTitle(chat.name(currentUserID: account.user?.id))
        .sheet(isPresented: $profileVisible) { PeerProfileScreen(chat: chat, account: account) }
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .onDisappear { finishTyping() }
        .sheet(item: $forwarding) { MessageForwardSheet(account: account, message: $0) }
        .sheet(item: $displayReaders) { MessageReadersSheet(account: account, chat: chat, message: $0) }
        .alert("Изменить сообщение", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } }), presenting: editing) { item in
            TextField("Текст", text: $editText)
            Button("Сохранить") { let text = editText; runAction { try await account.client.edit(messageID: item.id, text: text) } }
                .disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Отмена", role: .cancel) {}
        }
        .confirmationDialog("Удалить сообщение?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), presenting: deleteTarget) { item in
            Button("Удалить", role: .destructive) { runAction { try await account.client.delete(messageID: item.id) } }
            Button("Отмена", role: .cancel) {}
        }
        .task(id: "\(scenePhase == .active)-\(!pendingReads.isEmpty)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled && !pendingReads.isEmpty {
                do {
                    try await Task.sleep(for: .milliseconds(350))
                    let batch = Array(pendingReads.prefix(50))
                    try await account.client.markRead(chatID: chat.id, messageIDs: batch)
                    completedReads.formUnion(batch); pendingReads.subtract(batch)
                } catch {
                    if Task.isCancelled { return }
                    do { try await Task.sleep(for: .seconds(10)) } catch { return }
                }
            }
        }
        .task(id: "\(chat.id)-\(scenePhase == .active)-\(account.socketRevision)-\(account.chatRevisions[chat.id, default: 0])") {
            guard scenePhase == .active else { return }
            repeat {
                await load()
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            } while !Task.isCancelled
        }
    }

    private func messageRow(_ message: Message, width: CGFloat) -> some View {
        let own = message.senderID == account.user?.id
        return MessageLine(message: message, grouped: groupedIDs.contains(message.id), account: account, maximumWidth: width,
                           showAuthor: chat.type == "group", onReaction: { react($0, to: message) })
            .contextMenu {
                if message.metadata?.deleted != true {
                    Button("Ответить", systemImage: "arrowshape.turn.up.left") { replying = message }
                    Menu("Реакция", systemImage: "face.smiling") {
                        ForEach(["❤️", "👍", "😂", "😮", "🔥"], id: \.self) { emoji in Button(emoji) { react(emoji, to: message) } }
                    }
                    if !message.body.isEmpty {
                        Button("Копировать", systemImage: "doc.on.doc") {
                            #if os(iOS)
                            UIPasteboard.general.string = message.body
                            #else
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message.body, forType: .string)
                            #endif
                        }
                    }
                    if ["text", "file", "image"].contains(message.kind) { Button("Переслать", systemImage: "arrowshape.turn.up.right") { forwarding = message } }
                    if own && message.kind == "text" { Button("Изменить", systemImage: "pencil") { editText = message.body; editing = message } }
                    if own && chat.isSaved != true { Button("Просмотры", systemImage: "eye") { displayReaders = message } }
                    if own && message.kind != "system" { Button("Удалить", systemImage: "trash", role: .destructive) { deleteTarget = message } }
                }
            }
    }

    private func react(_ emoji: String, to message: Message) {
        let remove = message.reactions?.contains { $0.emoji == emoji && $0.userIds.contains(account.user?.id ?? "") } ?? false
        runAction { try await account.client.react(messageID: message.id, emoji: emoji, remove: remove) }
    }

    private func runAction(_ perform: @escaping @MainActor () async throws -> Void) {
        guard !actionBusy else { return }
        actionBusy = true
        Task {
            defer { actionBusy = false }
            do { try await perform(); await load() }
            catch { self.error = error.localizedDescription }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let typists = account.typists[chat.id], !typists.isEmpty {
                TimelineView(.periodic(from: .now, by: 1)) { tick in
                    let names = typists.values.filter { $0.expiry > tick.date }.map(\.name).sorted()
                    if !names.isEmpty {
                        Text(names.joined(separator: ", ") + (names.count == 1 ? " печатает…" : " печатают…"))
                            .font(.caption).foregroundStyle(Brand.muted).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            if let replying {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left")
                    Text(replying.preview).font(.caption).lineLimit(1)
                    Spacer()
                    Button { self.replying = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Отменить ответ")
                }.foregroundStyle(Brand.accent)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack(alignment: .bottom, spacing: 8) {
                #if os(iOS)
                PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "photo").frame(width: 36, height: 44) }
                    .buttonStyle(.plain).disabled(sending || replying != nil).accessibilityLabel("Отправить фотографию")
                    .onChange(of: photo) { _, item in
                        guard let item else { return }
                        Task {
                            defer { photo = nil }
                            await sendAttachment {
                                guard let bytes = try await item.loadTransferable(type: Data.self) else { throw URLError(.cannotDecodeContentData) }
                                return try await Task.detached { try ChatAttachment.photo(bytes) }.value
                            }
                        }
                    }
                Button { choosingFile = true } label: { Image(systemName: "paperclip").frame(width: 34, height: 44) }
                    .buttonStyle(.plain).disabled(sending || replying != nil).accessibilityLabel("Отправить файл")
                    .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.item]) { result in
                        switch result {
                        case .success(let url):
                            Task { await sendAttachment { try await Task.detached { try ChatAttachment.file(url) }.value } }
                        case .failure(let problem):
                            if (problem as NSError).code != NSUserCancelledError { error = problem.localizedDescription }
                        }
                    }
                #endif
                TextField("Сообщение", text: Binding(get: { draft }, set: { draft = $0; noticeTyping($0) }), axis: .vertical)
                    .lineLimit(1...5).webInput()
                    .accessibilityIdentifier("chat.composer")
                Button { Task { await send() } } label: {
                    Image(systemName: "paperplane").font(.system(size: 19))
                        .frame(width: 44, height: 44).background(Brand.gradient, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(.black)
                }.buttonStyle(.plain)
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Отправить сообщение")
                    .accessibilityIdentifier("chat.send")
            }
        }.padding(.horizontal, 12).padding(.vertical, 8).background(Brand.chatCanvas)
    }

    private func load(older: Bool = false) async {
        if older && loadingOlder { return }
        if older { loadingOlder = true } else { pageRevision += 1 }
        let expected = pageRevision
        defer { if older { loadingOlder = false } }
        do {
            let page = try await account.client.messages(chatID: chat.id, before: older ? messages.first?.createdAt : nil)
            try Task.checkCancellation()
            if !older && expected != pageRevision { return }
            if older {
                loadedHistory = true
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
                if !loadedHistory { messages = page.messages; hasMore = page.hasMore }
                else {
                    messages = previous + page.messages
                }
            }
            error = nil
            rebuildGroups()
        } catch { if !Task.isCancelled && (older || expected == pageRevision) { self.error = error.localizedDescription } }
    }

    private func noticeTyping(_ text: String) {
        guard chat.isSaved != true else { return }
        if text.isEmpty { finishTyping(); return }
        guard Date().timeIntervalSince(lastTypingNotice) >= 3 else { return }
        lastTypingNotice = Date()
        queueTyping(true)
    }

    private func finishTyping() {
        guard lastTypingNotice != .distantPast else { return }
        lastTypingNotice = .distantPast
        queueTyping(false)
    }

    private func queueTyping(_ active: Bool) {
        let previous = typingSend
        previous?.cancel()
        typingSend = Task { [client = account.client, chatID = chat.id] in
            await previous?.value
            guard !Task.isCancelled else { return }
            try? await client.typing(chatID: chatID, active: active)
        }
    }

    private func send() async {
        guard !sending else { return }
        let text = draft
        let replyID = replying?.id
        sending = true
        defer { sending = false }
        do {
            let message = try await account.client.send(chatID: chat.id, text: text, replyingTo: replyID)
            pageRevision += 1
            if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
            nearBottom = true; rebuildGroups()
            if draft == text { draft = ""; finishTyping() }
            if replying?.id == replyID { replying = nil }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    #if os(iOS)
    private func sendAttachment(_ prepare: () async throws -> ChatAttachment) async {
        guard !sending else { return }
        sending = true
        defer { sending = false }
        do {
            let attachment = try await prepare()
            let message = try await account.client.sendAttachment(chatID: chat.id, bytes: attachment.bytes,
                filename: attachment.name, image: attachment.isImage, thumbnail: attachment.thumbnail)
            pageRevision += 1
            if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
            nearBottom = true; rebuildGroups(); error = nil
        } catch { self.error = error.localizedDescription }
    }
    #endif

    private func rebuildGroups() {
        var result: Set<String> = []
        for index in messages.indices where index > 0 {
            let current = messages[index], previous = messages[index - 1]
            if current.kind == "text", previous.kind == "text", current.senderID == previous.senderID,
               let date = WireDate.parse(current.createdAt), let before = WireDate.parse(previous.createdAt),
               (0...300).contains(date.timeIntervalSince(before)), Calendar.current.isDate(date, inSameDayAs: before) { result.insert(current.id) }
        }
        groupedIDs = result
    }
}
