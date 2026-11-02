import SwiftUI

struct WaitingPersonCard: View {
    let person: CallController.WaitingPerson
    let account: AccountStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(person.sent ? "ВЫЗОВ ОТПРАВЛЕН" : "СОЕДИНЯЕМ…").font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundStyle(Brand.muted)
            HStack(spacing: 14) {
                ProfileAvatar(name: person.name, url: person.avatar, client: account.client, size: 50)
                VStack(alignment: .leading, spacing: 7) {
                    Text(person.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    Text("Ожидаем подключения").font(.system(size: 12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 4)
                Image(systemName: "phone.arrow.up.right").foregroundStyle(Brand.accent)
            }
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).trlkaPanel(20)
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.accent.opacity(pulse ? 0.5 : 0.12), lineWidth: 1))
            .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true } } }
    }
}
