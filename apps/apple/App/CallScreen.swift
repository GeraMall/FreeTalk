import SwiftUI
import WebRTC
import TRLKACore

struct CallScreen: View {
    let account: AccountStore
    @State private var more = false
    @State private var invite = false
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    var body: some View {
        let call = account.calls
        VStack(spacing: 16) {
            HStack(spacing: 14) {
                Button { call.presented = false } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 42, height: 42).trlkaPanel(14) }
                    .buttonStyle(.plain).accessibilityLabel("Свернуть звонок")
                VStack(alignment: .leading, spacing: 5) {
                    Text(call.title).font(.headline).lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(call.phase == .connected ? Brand.cyan : Brand.muted).frame(width: 6, height: 6)
                        Text(call.phase == .connected ? (call.participants.count < 2 ? "Ожидаем участников" : "На связи") : "Подключение…").font(.caption).foregroundStyle(Brand.muted)
                    }
                }
                Spacer(minLength: 4)
                Text(call.startedAt, style: .timer).font(.caption.monospacedDigit()).foregroundStyle(Brand.muted)
            }
            HStack {
                Text("Участники · \(call.participants.count) из 8").font(.subheadline.weight(.semibold))
                Spacer()
                Button { invite = true } label: { Label("Добавить", systemImage: "person.badge.plus").font(.caption.weight(.semibold)) }
                    .buttonStyle(.bordered).disabled(call.participants.count >= 8 || call.roomID.isEmpty)
            }
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(call.participants) { participant in
                        ParticipantCard(participant: participant, account: account, mirrorSelf: mirrorSelf)
                    }
                    if call.participants.isEmpty { ProgressView("Подключаемся к комнате…").padding(40) }
                }
            }
            HStack(spacing: 10) {
                CallButton(title: "Микрофон", icon: call.muted ? "mic.slash.fill" : "mic.fill", color: call.muted ? .pink : Brand.cyan) { call.setMuted(!call.muted) }
                CallButton(title: "Камера", icon: call.cameraOn ? "video.fill" : "video.slash.fill", color: call.cameraOn ? Brand.cyan : .pink) { Task { await call.toggleCamera() } }
                    .disabled(call.cameraBusy)
                CallButton(title: "Ещё", icon: "ellipsis", color: .white) { more = true }
                CallButton(title: "Выйти", icon: "rectangle.portrait.and.arrow.right", color: .white, destructive: true) { call.end() }
            }
            .frame(maxWidth: 360).padding(.vertical, 8)
        }
        .padding(.horizontal, 16).padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.background)
        .sheet(isPresented: $more) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Настройки звонка").font(.title2.bold())
                #if os(iOS)
                Button { account.calls.toggleSpeaker() } label: {
                    Label(account.calls.speaker ? "Динамик включён" : "Разговорный динамик", systemImage: account.calls.speaker ? "speaker.wave.2.fill" : "ear")
                }
                #endif
                Toggle("Зеркалить свою камеру", isOn: $mirrorSelf)
                Text("Другие участники видят камеру без зеркального отражения.").font(.caption).foregroundStyle(Brand.muted)
                ShareLink(item: URL(string: "https://trlka.com/join/\(account.calls.roomID)")!) { Label("Поделиться комнатой", systemImage: "square.and.arrow.up") }
                Text("Код комнаты: \(account.calls.roomID)").font(.callout.monospaced()).textSelection(.enabled)
                Button("Готово") { more = false }
            }.padding(24).presentationDetents([.medium])
        }
        .sheet(isPresented: $invite) { InviteToCallScreen(account: account) }
        .alert("Звонок", isPresented: Binding(get: { call.error != nil }, set: { if !$0 { call.error = nil } })) {
            Button("Понятно") { call.error = nil }
        } message: { Text(call.error ?? "") }
    }
}

struct ParticipantCard: View {
    let participant: RoomParticipant
    let account: AccountStore
    let mirrorSelf: Bool
    @State private var pulse = false
    var body: some View {
        let call = account.calls
        VStack(alignment: .leading, spacing: 0) {
            if let screen = call.video(participantID: participant.id, source: "screen") {
                RTCVideoSurface(track: screen, mirrored: false).frame(height: 190).clipped()
            }
            if let video = call.video(participantID: participant.id) {
                RTCVideoSurface(track: video, mirrored: participant.id == call.selfID && mirrorSelf)
                    .frame(height: 200).clipped()
            }
            HStack(spacing: 14) {
                ProfileAvatar(name: participant.name, url: participant.avatar, client: account.client, size: 50)
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 7) {
                        Text(participant.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                        if participant.id == call.selfID { Text("вы").font(.system(size: 9, weight: .bold)).foregroundStyle(Brand.muted).padding(4).background(Brand.stroke, in: RoundedRectangle(cornerRadius: 4)) }
                        if participant.isOwner { Image(systemName: "crown").font(.caption).foregroundStyle(.yellow) }
                    }
                    Text(call.connectionState(participant.id)).font(.system(size: 12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 4)
                Image(systemName: participant.muted ? "mic.slash.fill" : "waveform").foregroundStyle(participant.muted ? Color.pink : Brand.cyan)
            }.padding(18)
        }
        .background(LinearGradient(colors: [Brand.surface, Brand.background], startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.cyan.opacity(call.participants.count == 1 ? (pulse ? 0.55 : 0.12) : 0.2), lineWidth: 1))
        .onAppear { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true } }
    }
}

struct CallButton: View {
    let title: String
    let icon: String
    let color: Color
    var destructive = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 21, weight: .medium))
                Text(title).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .foregroundStyle(color).frame(maxWidth: .infinity).frame(height: 68)
            .background(destructive ? Color(red: 0.91, green: 0.19, blue: 0.36) : color.opacity(0.1), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(color.opacity(0.15), lineWidth: 1))
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}

struct InviteToCallScreen: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var friends: [Friend] = []
    @State private var error: String?
    @State private var working = false
    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(friends) { friend in
                    Button {
                        working = true
                        Task {
                            defer { working = false }
                            do { try await account.client.invite(roomID: account.calls.roomID, userIDs: [friend.id]); dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack { ProfileAvatar(name: friend.display_name, url: friend.avatarUrl, client: account.client); Text(friend.display_name); Spacer(); Image(systemName: "phone.badge.plus") }
                    }.disabled(working || account.calls.participants.contains(where: { $0.accountId == friend.id }))
                }
            }
            .navigationTitle("Пригласить друзей")
            .toolbar { ToolbarItem { Button("Закрыть") { dismiss() } } }
            .task { do { friends = try await account.client.friends() } catch { self.error = error.localizedDescription } }
        }.presentationDetents([.medium, .large])
    }
}

#if os(iOS)
struct RTCVideoSurface: UIViewRepresentable {
    let track: RTCVideoTrack
    let mirrored: Bool
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView(frame: .zero); view.videoContentMode = .scaleAspectFit
        context.coordinator.attach(track, view); return view
    }
    func updateUIView(_ view: RTCMTLVideoView, context: Context) {
        context.coordinator.attach(track, view)
        view.transform = CGAffineTransform(scaleX: mirrored ? -1 : 1, y: 1)
    }
    static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) { coordinator.detach(view) }
    final class Coordinator {
        var track: RTCVideoTrack?
        func attach(_ value: RTCVideoTrack, _ view: RTCMTLVideoView) { if track !== value { track?.remove(view); track = value; value.add(view) } }
        func detach(_ view: RTCMTLVideoView) { track?.remove(view); track = nil }
    }
}
#else
struct RTCVideoSurface: NSViewRepresentable {
    let track: RTCVideoTrack
    let mirrored: Bool
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> RTCMTLNSVideoView { let view = RTCMTLNSVideoView(frame: .zero); context.coordinator.attach(track, view); return view }
    func updateNSView(_ view: RTCMTLNSVideoView, context: Context) { context.coordinator.attach(track, view) }
    static func dismantleNSView(_ view: RTCMTLNSVideoView, coordinator: Coordinator) { coordinator.detach(view) }
    final class Coordinator {
        var track: RTCVideoTrack?
        func attach(_ value: RTCVideoTrack, _ view: RTCMTLNSVideoView) { if track !== value { track?.remove(view); track = value; value.add(view) } }
        func detach(_ view: RTCMTLNSVideoView) { track?.remove(view); track = nil }
    }
}
#endif
