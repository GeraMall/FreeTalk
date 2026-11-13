import SwiftUI
import TRLKACore

struct PeerProfileScreen: View {
    let chat: Chat
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var profile: PeerProfile?
    @State private var error: String?
    private var peer: ChatMember? { chat.members.first { $0.id != account.user?.id } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if chat.type == "group" {
                        Text("Участники — \(chat.members.count)").font(.title3.bold())
                        ForEach(chat.members, id: \.id) { member in
                            HStack(spacing: 12) {
                                ProfileAvatar(name: member.displayName, url: member.avatarUrl, client: account.client, size: 40)
                                VStack(alignment: .leading, spacing: 4) { Text(member.displayName).font(.headline); Text("@\(member.username)").font(.caption).foregroundStyle(Brand.muted) }
                                Spacer()
                            }.padding(12).webPanel(14)
                        }
                    } else {
                        ProfileCover(url: profile?.coverUrl, client: account.client)
                            .overlay(alignment: .bottomLeading) { ProfileAvatar(name: profile?.displayName ?? peer?.displayName ?? "TRLKA", url: profile?.avatarUrl ?? peer?.avatarUrl, client: account.client, size: 72).offset(x: 16, y: 25) }.padding(.bottom, 25)
                        Text(profile?.displayName ?? peer?.displayName ?? "Профиль").font(.system(size: 24, weight: .bold))
                        Text("@\(profile?.username ?? peer?.username ?? "")").font(.caption).foregroundStyle(Brand.muted)
                        Divider()
                        Text("О СЕБЕ").font(.system(size: 10, weight: .bold)).foregroundStyle(Brand.accent)
                        Text(profile?.bio?.isEmpty == false ? profile!.bio! : "Пользователь пока ничего о себе не рассказал.").font(.system(size: 14)).foregroundStyle(Brand.muted)
                        if let error { Text(error).font(.caption).foregroundStyle(.pink) }
                    }
                }.padding(20).webPanel(18).padding(16)
            }.background(Brand.chatCanvas).navigationTitle(chat.type == "group" ? "Участники" : "Профиль")
                .toolbar { ToolbarItem { Button("Готово") { dismiss() } } }
        }.presentationDetents([.large])
            .task { guard chat.type != "group", let peer else { return }; do { profile = try await account.client.profile(userID: peer.id) } catch { self.error = error.localizedDescription } }
    }
}
