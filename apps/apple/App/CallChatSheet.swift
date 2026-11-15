import SwiftUI
import TRLKACore
#if os(iOS)
import PhotosUI
import QuickLook
import UniformTypeIdentifiers
#else
import AppKit
#endif

struct CallChatSheet: View {
    let account: AccountStore
    @State private var chat: Chat?
    @State private var failure: String?
    @State private var retry = 0

    var body: some View {
        Group {
            if let chat = account.calls.attachedChat ?? chat { NavigationStack { ConversationView(chat: chat, account: account) } }
            else if account.calls.chatID != nil {
                if let failure {
                    VStack(spacing: 12) { Text(failure); Button("Повторить") { retry += 1 } }
                } else { ProgressView("Открываем переписку…") }
            } else { RoomConversation(account: account) }
        }
        .task(id: (account.calls.chatID ?? "") + String(retry)) {
            guard let id = account.calls.chatID, account.calls.attachedChat == nil else { return }
            failure = nil
            do {
                let result = try await account.client.chats()
                guard !Task.isCancelled, account.calls.chatID == id else { return }
                if let found = result.first(where: { $0.id == id }) { chat = found }
                else { failure = "Переписка недоступна." }
            } catch { if !Task.isCancelled { failure = error.localizedDescription } }
        }
    }
}

private struct RoomConversation: View {
    let account: AccountStore
    private var room: NativeRoomChat { account.calls.roomChat }
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var reply: RoomMessage?
    @State private var editing: RoomMessage?
    @State private var deleting: RoomMessage?
    @State private var failure: String?
    @State private var sending = false
    #if os(iOS)
    @State private var pickingFile = false
    @State private var photo: PhotosPickerItem?
    @State private var attachment: ChatAttachment?
    #endif

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Чат комнаты", systemImage: "bubble.left.and.bubble.right").font(.headline)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 36, height: 36) }.accessibilityLabel("Закрыть чат")
            }.padding(.horizontal).padding(.top, 12)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if room.messages.isEmpty { Text("Сообщения сохраняются до завершения звонка.").font(.footnote).foregroundStyle(Brand.muted) }
                        ForEach(room.messages) { message in messageRow(message).id(message.id) }
                    }.padding()
                }
                .onAppear { if let id = room.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
                .onChange(of: room.messages.last?.id) { _, id in if let id { proxy.scrollTo(id, anchor: .bottom) } }
            }
            if !room.typing.isEmpty {
                let names = room.typing.values.sorted().joined(separator: ", ")
                Text(names + (room.typing.count == 1 ? " печатает…" : " печатают…"))
                    .font(.caption).foregroundStyle(Brand.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
            }
            Divider()
            if let value = editing ?? reply {
                HStack {
                    Text((editing == nil ? "Ответ · " : "Изменение · ") + value.text).lineLimit(1)
                    Spacer()
                    Button { if editing != nil { draft = "" }; editing = nil; reply = nil } label: { Image(systemName: "xmark.circle") }
                }.font(.caption).padding(.horizontal).padding(.top, 5)
            }
            #if os(iOS)
            if let attachment {
                HStack {
                    Label(attachment.name, systemImage: attachment.isImage ? "photo" : "doc").lineLimit(1)
                    Button { self.attachment = nil } label: { Image(systemName: "xmark.circle") }
                }.font(.caption).padding(.top, 5)
            }
            #endif
            HStack(alignment: .bottom, spacing: 10) {
                #if os(iOS)
                Menu {
                    PhotosPicker(selection: $photo, matching: .images) { Label("Фото", systemImage: "photo") }
                    Button { pickingFile = true } label: { Label("Файл", systemImage: "doc") }
                } label: { Image(systemName: "paperclip").frame(width: 32, height: 36) }
                    .disabled(!room.supportsFiles || sending || editing != nil).accessibilityLabel("Прикрепить файл")
                #endif
                TextField("Написать сообщение…", text: $draft, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                    .disabled(!room.joined || sending)
                Button { Task { await submit() } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2).frame(minWidth: 36, minHeight: 36)
                }.disabled(!canSend).accessibilityLabel("Отправить")
            }.padding(.horizontal).padding(.vertical, 10)
            if let failure { Text(failure).font(.caption).foregroundStyle(.red).padding(.horizontal) }
        }
        .background(Brand.background)
        .onChange(of: draft) { _, text in room.notifyTyping(!text.isEmpty) }
        .onDisappear { room.notifyTyping(false) }
        .confirmationDialog("Удалить сообщение?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            presenting: deleting) { value in
            Button("Удалить", role: .destructive) { room.action(["kind": "delete", "id": value.id]); deleting = nil }
        }
        #if os(iOS)
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.item]) { result in
            do {
                let url = try result.get()
                Task {
                    do { let file = try await Task.detached { try ChatAttachment.file(url, maxBytes: 10 * 1024 * 1024) }.value; attachment = file }
                    catch { failure = error.localizedDescription }
                }
            } catch { if (error as NSError).code != NSUserCancelledError { failure = error.localizedDescription } }
        }
        .task(id: photo) {
            guard let item = photo else { return }
            do {
                guard let bytes = try await item.loadTransferable(type: Data.self) else { throw URLError(.cannotDecodeContentData) }
                let image = try await Task.detached { try ChatAttachment.photo(bytes) }.value
                guard !Task.isCancelled else { return }
                attachment = image; photo = nil
            } catch { if !Task.isCancelled { failure = error.localizedDescription } }
        }
        #endif
    }

    private var canSend: Bool {
        guard room.joined, !sending, draft.utf16.count <= 2000 else { return false }
        #if os(iOS)
        if attachment != nil { return true }
        #endif
        return !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() async {
        guard canSend else { return }
        sending = true; defer { sending = false }; failure = nil
        do {
            if let editing {
                guard room.action(["kind": "edit", "id": editing.id, "text": draft.trimmingCharacters(in: .whitespacesAndNewlines)]) else { throw URLError(.notConnectedToInternet) }
            } else {
                var text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                var fileID: UUID?
                #if os(iOS)
                if let attachment {
                    let type = attachment.isImage ? "image/jpeg" : (UTType(filenameExtension: (attachment.name as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream")
                    let file = try await room.upload(attachment.bytes, name: attachment.name, mime: type)
                    fileID = file.id
                    if text.isEmpty { text = file.name }
                }
                #endif
                try room.send(text, attachment: fileID, reply: reply?.id)
            }
            draft = ""; reply = nil; editing = nil
            #if os(iOS)
            attachment = nil
            #endif
            room.notifyTyping(false)
        } catch { failure = error.localizedDescription }
    }

    @ViewBuilder private func messageRow(_ message: RoomMessage) -> some View {
        let own = message.participantId == account.calls.selfID
        let removed = message.deleted == true
        VStack(alignment: own ? .trailing : .leading, spacing: 3) {
            HStack { Text(message.senderName).font(.caption.weight(.semibold)); Text(Date(timeIntervalSince1970: message.timestamp / 1000), style: .time).font(.caption2).foregroundStyle(Brand.muted) }
            VStack(alignment: .leading, spacing: 4) {
                if let ref = message.replyTo, let quoted = room.messages.first(where: { $0.id == ref }) {
                    Label(quoted.text, systemImage: "arrowshape.turn.up.left").lineLimit(1).font(.caption).foregroundStyle(Brand.muted)
                }
                #if os(iOS)
                if let file = message.attachment { RoomFileLink(file: file, chat: room) }
                #endif
                if message.attachment?.name != message.text || removed { Text(message.text).font(.body) }
                if message.editedAt != nil && !removed { Text("Изменено").font(.caption2).foregroundStyle(Brand.muted) }
            }.padding(.horizontal, 10).padding(.vertical, 7).background(own ? Brand.accent.opacity(0.22) : Brand.surface, in: RoundedRectangle(cornerRadius: 12))
            .contextMenu {
                if !removed {
                    if room.supportsActions { Button("Ответить") { editing = nil; reply = message } }
                    Button("Скопировать") {
                        #if os(iOS)
                        UIPasteboard.general.string = message.text
                        #else
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message.text, forType: .string)
                        #endif
                    }
                    if room.supportsActions {
                        Menu("Реакция") { ForEach(["❤️","👍","😂","🎉","🔥"], id: \.self) { emoji in Button(emoji) { room.action(["kind": "react", "id": message.id, "emoji": emoji]) } } }
                        if own && message.attachment == nil {
                            Button("Изменить") {
                                #if os(iOS)
                                attachment = nil
                                #endif
                                reply = nil; editing = message; draft = message.text
                            }
                        }
                        if own || account.calls.participants.first(where: { $0.id == account.calls.selfID })?.isOwner == true {
                            Button("Удалить", role: .destructive) { deleting = message }
                        }
                    }
                }
            }
            if let reactions = message.reactions, !reactions.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 5) {
                        ForEach(reactions, id: \.emoji) { reaction in
                            Button(reaction.emoji + " " + String(reaction.userIds.count)) {
                                room.action(["kind": "react", "id": message.id, "emoji": reaction.emoji])
                            }.font(.caption).buttonStyle(.bordered)
                        }
                    }
                }.scrollIndicators(.hidden).fixedSize(horizontal: false, vertical: true)
                .defaultScrollAnchor(own ? .trailing : .leading)
            }
        }.frame(maxWidth: .infinity, alignment: own ? .trailing : .leading)
    }
}

#if os(iOS)
private struct RoomFileLink: View {
    let file: RoomMessageFile
    let chat: NativeRoomChat
    @State private var preview: URL?
    @State private var directory: URL?
    @State private var busy = false
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                guard !busy else { return }; busy = true
                Task {
                    defer { busy = false }
                    do {
                        let bytes = try await chat.download(file)
                        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                        directory = folder
                        let basename = (file.name as NSString).lastPathComponent
                        let safe = basename.isEmpty || basename == "." || basename == ".." ? "file" : basename
                        let url = folder.appendingPathComponent(safe)
                        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
                        preview = url; failure = nil
                    } catch { cleanup(); failure = error.localizedDescription }
                }
            } label: { Label(file.name, systemImage: busy ? "hourglass" : (file.image ? "photo" : "doc")).lineLimit(2) }
                .disabled(busy).quickLookPreview($preview)
            if let failure { Text(failure).font(.caption).foregroundStyle(.red) }
        }
        .onChange(of: preview) { _, url in if url == nil { cleanup() } }
        .onDisappear { cleanup() }
    }
    private func cleanup() { if let directory { try? FileManager.default.removeItem(at: directory) }; directory = nil }
}
#endif
