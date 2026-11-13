import SwiftUI

struct WaitingPersonCard: View {
    let person: CallController.WaitingPerson
    let account: AccountStore
    var side: CGFloat = 170
    var tileSize: CGSize?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    var body: some View {
        VStack(spacing: 8) {
            ProfileAvatar(name: person.name, url: person.avatar, client: account.client, size: min(64, side * 0.32))
            Text(person.name).font(.system(size: side < 140 ? 12 : 14, weight: .semibold)).lineLimit(1)
            if side >= 135 { Text("Ожидаем подключения").font(.system(size: 11)).foregroundStyle(Brand.muted).lineLimit(1) }
            Image(systemName: "phone.arrow.up.right").foregroundStyle(Brand.accent)
        }.padding(12).frame(width: tileSize?.width ?? side, height: tileSize?.height ?? side).trlkaPanel(20)
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.accent.opacity(pulse ? 0.5 : 0.12), lineWidth: 1))
            .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true } } }
    }
}
