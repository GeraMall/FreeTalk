import SwiftUI
import TRLKACore

struct AppShell: View {
    let account: AccountStore
    @State private var page: Page = .home
    @State private var path: [Chat] = []
    @State private var profile = false
    enum Page: String, CaseIterable {
        case home = "Главная", chats = "Чаты", friends = "Друзья", history = "История"
        var icon: String {
            switch self { case .home: return "door.left.hand.open"; case .chats: return "bubble.left"; case .friends: return "person.2"; case .history: return "clock.arrow.circlepath" }
        }
    }
    var body: some View {
        @Bindable var call = account.calls
        NavigationStack(path: $path) {
            Group {
                switch page {
                case .home: HomeScreen(account: account)
                case .chats: ChatListScreen(account: account)
                case .friends: FriendsScreen(account: account)
                case .history: HistoryScreen(account: account)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Brand.background)
            .navigationDestination(for: Chat.self) { ConversationView(chat: $0, account: account) }
            .toolbar {
                if path.isEmpty {
                    ToolbarItem(placement: .automatic) {
                        HStack(spacing: 8) {
                            Image("BrandMark").resizable().scaledToFit().frame(width: 28, height: 28)
                            Text("TRLKA").font(.system(size: 19, weight: .heavy))
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                ToolbarItem(placement: .automatic) {
                    Button { profile = true } label: {
                        ProfileAvatar(name: account.user?.displayName ?? "", url: account.user?.avatarUrl, client: account.client, size: 34)
                    }.accessibilityLabel("Настройки")
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if call.active && !call.presented {
                    Button { call.presented = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "phone.fill")
                            Text(call.phase == .connected ? "Перейти к звонку" : "Подключение…").font(.subheadline.bold())
                            Spacer()
                            Text(call.startedAt, style: .timer).font(.caption.monospacedDigit())
                            Image(systemName: "chevron.right")
                        }.padding(.horizontal, 16).padding(.vertical, 10)
                        .foregroundStyle(call.phase == .connected ? Color.green : Brand.muted)
                        .background((call.phase == .connected ? Color.green : Brand.muted).opacity(0.12))
                    }.buttonStyle(.plain)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 4) {
                ForEach(Page.allCases, id: \.self) { item in
                    Button {
                        path = []; withAnimation(.easeOut(duration: 0.16)) { page = item }
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: item.icon).font(.system(size: 21))
                            Text(item.rawValue).font(.system(size: 10, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .foregroundStyle(page == item ? Brand.cyan : Brand.muted)
                        .background(page == item ? Brand.cyan.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain)
                }
            }.padding(.horizontal, 8).padding(.top, 7).padding(.bottom, 3)
                .background(Brand.background.opacity(0.98))
                .overlay(alignment: .top) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
        }
        .sheet(isPresented: $profile) { ProfileView(account: account) }
        #if os(iOS)
        .fullScreenCover(isPresented: $call.presented) { CallScreen(account: account) }
        #else
        .sheet(isPresented: $call.presented) { CallScreen(account: account).frame(minWidth: 600, minHeight: 600) }
        #endif
        .overlay(alignment: .top) {
            if let invitation = account.incoming {
                VStack(spacing: 16) {
                    ProfileAvatar(name: invitation.inviter.displayName, url: invitation.inviter.avatarUrl, client: account.client, size: 64)
                    Text(invitation.inviter.displayName).font(.title3.bold())
                    Text("Входящий звонок").foregroundStyle(Brand.muted)
                    HStack(spacing: 16) {
                        Button("Отклонить", role: .destructive) { Task { await account.answerIncoming(accept: false) } }
                            .buttonStyle(.bordered)
                        Button("Ответить") { Task { await account.answerIncoming(accept: true) } }
                            .buttonStyle(.borderedProminent).disabled(account.calls.active)
                    }
                }.padding(24).frame(maxWidth: 400).trlkaPanel(24).shadow(radius: 24).padding()
            }
        }
        .alert("TRLKA", isPresented: Binding(get: { call.error != nil || account.error != nil }, set: { if !$0 { call.error = nil; account.error = nil } })) {
            Button("Понятно") { call.error = nil; account.error = nil }
        } message: { Text(call.error ?? account.error ?? "") }
    }
}
