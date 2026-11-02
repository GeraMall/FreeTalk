import SwiftUI
import TRLKACore

struct MessageLine: View {
    let message: Message
    let grouped: Bool
    let account: AccountStore
    private var name: String { message.displayName ?? (message.senderID == account.user?.id ? account.user?.displayName : nil) ?? "TRLKA" }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if grouped { Color.clear.frame(width: 36, height: 1) }
            else { ProfileAvatar(name: name, url: message.avatarURL, client: account.client, size: 36) }
            VStack(alignment: .leading, spacing: 5) {
                if !grouped {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                            .foregroundStyle(message.senderID == account.user?.id ? Brand.accent : Color.primary)
                        if let date = WireDate.parse(message.createdAt) {
                            Text(date, style: .time).font(.system(size: 10)).foregroundStyle(Brand.muted)
                        }
                    }
                }
                if message.kind == "call" {
                    HStack(spacing: 12) {
                        Image(systemName: "phone").font(.system(size: 22)).foregroundStyle(message.metadata?.ended == true ? Color.pink : Brand.accent)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(message.body.isEmpty ? "Голосовой звонок" : message.body).font(.subheadline.weight(.semibold))
                            if message.metadata?.ended == true { Text("Звонок завершён").font(.caption).foregroundStyle(Brand.muted) }
                            else if let code = message.metadata?.roomId {
                                Button("Присоединиться") { if let user = account.user { Task { await account.calls.start(user: user, join: code) } } }
                                    .buttonStyle(.bordered).font(.caption)
                            }
                        }
                    }.padding(14).frame(maxWidth: .infinity, alignment: .leading).trlkaPanel(14)
                } else {
                    Text(message.preview).font(.system(size: 15)).lineSpacing(3).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, grouped ? 2 : 8)
        .accessibilityElement(children: .contain)
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
