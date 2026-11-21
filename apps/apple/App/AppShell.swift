import SwiftUI
import TRLKACore

struct AppShell: View {
    let account: AccountStore
    @State private var page: Page = .home
    @State private var path: [Chat] = []
    @State private var profile = false
    @State private var keyboardVisible = false
    @State private var conversationVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @AppStorage(MobileNavigation.showQRKey) private var showQR = true
    @State private var scanLogin = false
    #endif
    init(account: AccountStore) {
        self.account = account
        #if DEBUG
        let mode = PreviewFixtures.mode
        _page = State(initialValue: ["chats", "conversation", "minimized", "bot", "bot-profile"].contains(mode ?? "") ? .chats : mode == "friends" ? .friends : mode == "history" ? .history : .home)
        _path = State(initialValue: ["bot", "bot-profile"].contains(mode ?? "") ? [Chat.service] : mode == "conversation" || mode == "minimized" ? [PreviewFixtures.chat] : [])
        _profile = State(initialValue: mode == "settings")
        #endif
    }
    enum Page: String, CaseIterable {
        case home = "Главная", chats = "Чаты", friends = "Друзья", history = "История"
        var icon: String {
            switch self { case .home: return "house"; case .chats: return "bubble.left.and.bubble.right"; case .friends: return "person.2"; case .history: return "clock.arrow.circlepath" }
        }
    }
    var body: some View {
        @Bindable var call = account.calls
        VStack(spacing: 0) {
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
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 28, height: 28)
                    Text("TRLKA").font(.system(size: 19, weight: .heavy)).accessibilityIdentifier("app.brand")
                    Spacer()
                    Button { profile = true } label: {
                        ProfileAvatar(name: account.user?.displayName ?? "", url: account.user?.avatarUrl, client: account.client, size: 36)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }.accessibilityLabel("Настройки").accessibilityIdentifier("app.profile")
                }.padding(.horizontal, 18).padding(.vertical, 8)
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
            .background(Brand.webBackground)
            .navigationDestination(for: Chat.self) { chat in
                if chat.isService { ServiceBotScreen(account: account) }
                else { ConversationView(chat: chat, account: account) }
            }
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        .onPreferenceChange(ChatDestinationKey.self) { conversationVisible = $0 }
        // The bar participates in layout so destinations cannot draw behind it.
            if !keyboardVisible && !conversationVisible && path.isEmpty {
                bottomNavigation
            }
        }
        .background(Brand.webBackground)
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        #endif
        #if os(iOS)
        .fullScreenCover(isPresented: $profile) { ProfileView(account: account) }
        .sheet(isPresented: $scanLogin) { QRLoginScanner(account: account) }
        .fullScreenCover(isPresented: $call.presented) { CallScreen(account: account) }
        #else
        .sheet(isPresented: $profile) { ProfileView(account: account) }
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

    private var bottomNavigation: some View {
        HStack(spacing: 4) {
            tab(.home)
            tab(.chats)
            #if os(iOS)
            if showQR {
                Button { scanLogin = true } label: {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 23, weight: .semibold))
                        .frame(width: 46, height: 46)
                        .foregroundStyle(Brand.accent)
                        .background(Brand.accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Brand.accent.opacity(0.38)))
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                }
                .buttonStyle(CompactControlStyle())
                .accessibilityLabel("Сканировать QR для входа")
                .accessibilityIdentifier("tab.qr")
            }
            #endif
            tab(.friends)
            tab(.history)
        }
        .padding(.horizontal, 8).padding(.top, 7).padding(.bottom, 3)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
        .background(Brand.webBackground.opacity(0.98))
        .overlay(alignment: .top) { Rectangle().fill(Brand.stroke).frame(height: 0.5) }
    }

    private func tab(_ item: Page) -> some View {
        Button {
            path = []
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { page = item }
        } label: {
            VStack(spacing: 5) {
                Image(systemName: item.icon)
                    .font(.system(size: 22))
                    .symbolRenderingMode(.hierarchical)
                    .frame(width: 28, height: 25)
                Text(LocalizedStringKey(item.rawValue))
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .foregroundStyle(page == item ? Brand.accent : Brand.muted)
            .background(page == item ? Brand.accent.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .buttonStyle(CompactControlStyle())
        .accessibilityAddTraits(page == item ? .isSelected : [])
        .accessibilityIdentifier("tab.\(String(describing: item))")
    }
}
