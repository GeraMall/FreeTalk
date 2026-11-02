import SwiftUI
import TRLKACore

struct MessageLine: View {
    let message: Message
    let grouped: Bool
    let account: AccountStore
    var maximumWidth: CGFloat = 300
    var showAuthor = false
    private var own: Bool { message.senderID == account.user?.id }
    private var name: String { message.displayName ?? (own ? account.user?.displayName : nil) ?? "TRLKA" }
    var body: some View {
        Group {
            if message.kind == "call" {
                HStack(spacing: 12) {
                    Image(systemName: "phone").font(.system(size: 22)).foregroundStyle(.pink)
                        .frame(width: 44, height: 44).background(Color.pink.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(name) начал звонок").font(.system(size: 12, weight: .semibold))
                        Text(message.metadata?.ended == true ? "Звонок завершён" : "Голосовой звонок").font(.system(size: 11)).foregroundStyle(Brand.muted)
                    }
                    Spacer(minLength: 0)
                    if message.metadata?.ended != true, let code = message.metadata?.roomId {
                        Button("Войти") { if let user = account.user { Task { await account.calls.start(user: user, join: code) } } }
                            .buttonStyle(.bordered).font(.caption)
                    }
                }.padding(12).webPanel(16).padding(.vertical, 12)
            } else {
                HStack(alignment: .top, spacing: 7) {
                    if own { Spacer(minLength: 22) }
                    if !own { avatar }
                    WebMessageBubble(text: message.preview, date: WireDate.parse(message.createdAt), own: own, author: showAuthor && !own && !grouped ? name : nil)
                        .frame(maxWidth: maximumWidth, alignment: own ? .trailing : .leading)
                        .accessibilityIdentifier("message.bubble.\(message.id)")
                    if own { avatar }
                    if !own { Spacer(minLength: 22) }
                }.padding(.top, grouped ? 2 : 7)
            }
        }.accessibilityElement(children: .contain)
    }
    @ViewBuilder private var avatar: some View {
        if grouped { Color.clear.frame(width: 32, height: 1) }
        else { ProfileAvatar(name: name, url: message.avatarURL ?? (own ? account.user?.avatarUrl : nil), client: account.client, size: 32).accessibilityIdentifier("message.avatar.\(message.id)") }
    }
}
struct MessageBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
struct MessageViewportKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
