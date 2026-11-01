import SwiftUI
import TRLKACore

struct AppShell: View {
    let account: AccountStore
    @State private var page: Page = .home
    @State private var path: [Chat] = []
    @State private var profile = false
    @State private var keyboardVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    init(account: AccountStore) {
        self.account = account
        #if DEBUG
        let mode = PreviewFixtures.mode
        _page = State(initialValue: ["chats", "conversation", "minimized"].contains(mode ?? "") ? .chats : mode == "friends" ? .friends : mode == "history" ? .history : .home)
        _path = State(initialValue: mode == "conversation" || mode == "minimized" ? [PreviewFixtures.chat] : [])
        _profile = State(initialValue: mode == "settings")
        #endif
    }
    enum Page: String, CaseIterable {
        case home = "Главная", chats = "Чаты", friends = "Друзья", history = "История"
        var icon: String {
            switch self { case .home: return "house.fill"; case .chats: return "bubble.left.and.bubble.right.fill"; case .friends: return "person.2.fill"; case .history: return "clock.fill" }
        }
    }
    var body: some View {
        @Bindable var call = account.calls
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 28, height: 28)
                    Text("TRLKA").font(.system(size: 19, weight: .heavy)).accessibilityIdentifier("app.brand")
                    Spacer()
                    Button { profile = true } label: {
                        ProfileAvatar(name: account.user?.displayName ?? "", url: account.user?.avatarUrl, client: account.client, size: 36)
                    }.accessibilityLabel("Настройки").accessibilityIdentifier("app.profile")
                }.padding(.horizontal, 18).padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
            Group {
                switch page {
                case .home: HomeScreen(account: account)
                case .chats: ChatListScreen(account: account)
                case .friends: FriendsScreen(account: account)
                case .history: HistoryScreen(account: account)
                }
            }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Brand.background)
            .navigationDestination(for: Chat.self) { ConversationView(chat: $0, account: account) }
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
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
                        .foregroundStyle(call.qualityColor)
                        .background(call.qualityColor.opacity(0.12))
                    }.buttonStyle(CompactControlStyle()).accessibilityIdentifier("call.return")
                }
            }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !keyboardVisible {
            HStack(spacing: 4) {
                ForEach(Page.allCases, id: \.self) { item in
                    Button {
                        path = []; withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { page = item }
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: item.icon)
                                .font(.system(size: 22, weight: .semibold))
                                .symbolRenderingMode(.hierarchical)
                                .frame(width: 28, height: 25)
                            Text(item.rawValue).font(.system(size: 10, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .foregroundStyle(page == item ? Brand.cyan : Brand.muted)
                        .background(page == item ? Brand.cyan.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 14))
                        .contentShape(Rectangle())
                    }.buttonStyle(CompactControlStyle()).accessibilityIdentifier("tab.\(String(describing: item))")
                }
            }.padding(.horizontal, 8).padding(.top, 7).padding(.bottom, 3)
                .background(Brand.background.opacity(0.98))
                .overlay(alignment: .top) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
            }
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        #endif
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
        .alert("TRLKA", isPresented: Binding(get: { (!call.presented && call.error != nil) || account.error != nil }, set: { if !$0 { call.error = nil; account.error = nil } })) {
            Button("Понятно") { call.error = nil; account.error = nil }
        } message: { Text(call.error ?? account.error ?? "") }
    }
}
