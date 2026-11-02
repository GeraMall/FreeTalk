import SwiftUI
import TRLKACore

struct HomeScreen: View {
    let account: AccountStore
    @State private var roomCode = ""
    @State private var history: [CallHistoryItem] = []
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 20) {
                    SectionCaption(text: "СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!")
                    Text("\(greeting),\n\(account.user?.displayName ?? "друг")")
                        .font(.system(size: 31, weight: .bold)).tracking(-0.8).lineLimit(3).minimumScaleFactor(0.7)
                    Text("Создайте приватную комнату или войдите по приглашению.")
                        .font(.system(size: 15)).foregroundStyle(Brand.muted).lineSpacing(4)
                    Button {
                        guard let user = account.user else { return }
                        Task { await account.calls.start(user: user) }
                    } label: { Label("Создать комнату", systemImage: "door.left.hand.open") }
                        .buttonStyle(PrimaryButton()).disabled(account.calls.busy)
                    HStack(spacing: 8) {
                        TextField("Код или ссылка комнаты", text: $roomCode)
                            .font(.system(size: 16)).textFieldStyle(.plain).padding(14).webPanel(12)
                            #if os(iOS)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            #endif
                        Button {
                            guard let user = account.user else { return }
                            Task { await account.calls.start(user: user, join: roomCode) }
                        } label: { Image(systemName: "arrow.right").frame(width: 46, height: 48).webPanel(12) }
                            .buttonStyle(.plain).disabled(roomCode.isEmpty || account.calls.busy).accessibilityLabel("Войти в комнату")
                    }
                }
                .padding(22)
                .background(alignment: .trailing) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 190).opacity(0.07).offset(x: 40)
                }
                .background(LinearGradient(colors: [Brand.accent.opacity(0.07), Brand.blue.opacity(0.09)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .webPanel(22).clipShape(RoundedRectangle(cornerRadius: 22))

                VStack(alignment: .leading, spacing: 8) {
                    SectionCaption(text: "ВАШИ ЗВОНКИ")
                    Text("Недавние комнаты").font(.system(size: 22, weight: .bold))
                }
                if history.isEmpty {
                    Text("После первого разговора здесь появятся недавние комнаты.")
                        .font(.subheadline).foregroundStyle(Brand.muted).padding(18).frame(maxWidth: .infinity, alignment: .leading).webPanel()
                } else {
                    ForEach(Array(history.prefix(4))) { item in HistoryCard(item: item, account: account) }
                }
            }.padding(16).frame(maxWidth: 850).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .task(id: account.revision) { history = (try? await account.client.history()) ?? history }
    }
    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) { case 5..<12: return "Доброе утро"; case 12..<18: return "Добрый день"; case 18..<24: return "Добрый вечер"; default: return "Доброй ночи" }
    }
}

struct HistoryScreen: View {
    let account: AccountStore
    @State private var history: [CallHistoryItem] = []
    @State private var error: String?
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("История звонков").font(.system(size: 28, weight: .bold)).padding(.bottom, 10)
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(history) { HistoryCard(item: $0, account: account) }
                if history.isEmpty { Text("Здесь появятся завершённые разговоры.").foregroundStyle(Brand.muted) }
            }.padding(16).frame(maxWidth: 850).frame(maxWidth: .infinity)
        }
        .task(id: account.revision) { await load() }
        .refreshable { await load() }
    }
    private func load() async {
        do { history = try await account.client.history(); error = nil } catch { self.error = error.localizedDescription }
    }
}

struct HistoryCard: View {
    let item: CallHistoryItem
    let account: AccountStore
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ProfileAvatar(name: item.participants.first?.displayName ?? "T", url: item.participants.first?.avatarUrl, client: account.client)
                VStack(alignment: .leading, spacing: 5) {
                    Text(item.room_name ?? item.participants.map(\.displayName).joined(separator: ", ")).font(.headline).lineLimit(2)
                    Text("\(dateText) · \(item.duration_seconds / 60) мин").font(.caption).foregroundStyle(Brand.muted)
                }
            }
            Button {
                guard let user = account.user else { return }
                Task { await account.calls.start(user: user) }
            } label: {
                Label("Создать снова", systemImage: "phone").font(.caption.weight(.medium))
                    .frame(maxWidth: .infinity).padding(10).webPanel(12)
            }.buttonStyle(.plain)
        }.padding(16).webPanel()
    }
    private var dateText: String { WireDate.parse(item.started_at)?.formatted(date: .abbreviated, time: .shortened) ?? "" }
}

struct FriendsScreen: View {
    let account: AccountStore
    @State private var friends: [Friend] = []
    @State private var username = ""
    @State private var notice: String?
    @State private var working = false
    @State private var newChat: Chat?
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                Text("Друзья").font(.system(size: 28, weight: .bold))
                HStack(spacing: 10) {
                    TextField("Добавить по @username", text: $username).textFieldStyle(.plain)
                        #if os(iOS)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        #endif
                    Button {
                        working = true
                        Task {
                            defer { working = false }
                            do { try await account.client.addFriend(username: username); notice = "Запрос отправлен"; username = "" }
                            catch { notice = error.localizedDescription }
                        }
                    } label: { Image(systemName: "person.badge.plus").frame(width: 40, height: 40) }
                        .disabled(working || username.isEmpty)
                }.padding(12).webPanel(14)
                if let notice { Text(notice).font(.caption).foregroundStyle(Brand.muted) }
                ForEach(friends) { friend in
                    HStack(spacing: 12) {
                        ProfileAvatar(name: friend.display_name, url: friend.avatarUrl, client: account.client)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(friend.display_name).font(.headline).lineLimit(1)
                            Text(friend.presence == "online" ? "В сети" : "Не в сети").font(.caption).foregroundStyle(Brand.muted)
                        }
                        Spacer(minLength: 4)
                        Button {
                            working = true
                            Task {
                                defer { working = false }
                                do { newChat = try await account.client.createChat(memberIDs: [friend.id]) }
                                catch { notice = error.localizedDescription }
                            }
                        } label: { Image(systemName: "bubble.left").frame(width: 42, height: 42).webPanel(12) }
                            .buttonStyle(.plain).disabled(working).accessibilityLabel("Написать \(friend.display_name)")
                    }.padding(14).webPanel()
                }
                if friends.isEmpty { Text("Добавьте друзей по username.").foregroundStyle(Brand.muted) }
            }.padding(16).frame(maxWidth: 850).frame(maxWidth: .infinity)
        }
        .task(id: account.revision) { friends = (try? await account.client.friends()) ?? friends }
        .navigationDestination(item: $newChat) { ConversationView(chat: $0, account: account) }
    }
}
