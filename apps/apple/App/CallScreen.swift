import SwiftUI
import WebRTC
import TRLKACore

struct CallScreen: View {
    let account: AccountStore
    @State private var more = false
    @State private var invite = false
    @State private var videoMode = false
    @State private var focusedID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    var body: some View {
        let call = account.calls
        let hasVideo = call.participants.contains { call.video(participantID: $0.id) != nil || call.video(participantID: $0.id, source: "screen") != nil }
        VStack(spacing: 16) {
            if focusedID == nil {
            HStack(spacing: 14) {
                Button { call.presented = false } label: { Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44).trlkaPanel(14) }
                    .buttonStyle(CompactControlStyle()).accessibilityLabel("Свернуть звонок").accessibilityIdentifier("call.minimize")
                VStack(alignment: .leading, spacing: 5) {
                    Text(call.title).font(.headline).lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(call.qualityColor).frame(width: 6, height: 6)
                        Text(call.qualityText).font(.caption).foregroundStyle(Brand.muted)
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
            }
            if videoMode {
                VideoCallCanvas(account: account, mirrorSelf: mirrorSelf, focusedID: $focusedID)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(call.participants) { participant in
                            AudioParticipantRow(participant: participant, account: account)
                        }
                        ForEach(call.waiting) { person in
                            HStack(spacing: 12) {
                                ProfileAvatar(name: person.name, url: person.avatar, client: account.client, size: 42)
                                VStack(alignment: .leading, spacing: 5) { Text(person.name).font(.subheadline.weight(.semibold)).lineLimit(1); Text("Ожидаем подключения").font(.caption).foregroundStyle(Brand.muted) }
                                Spacer(minLength: 4)
                                Image(systemName: "phone.arrow.up.right").foregroundStyle(Brand.accent)
                            }.padding(14).trlkaPanel(18)
                        }
                        if call.participants.isEmpty && call.waiting.isEmpty { ProgressView("Подключаемся…").padding(32) }
                    }.padding(.vertical, 2)
                }.scrollIndicators(.hidden).accessibilityIdentifier("call.audio-list")
            }
            HStack(spacing: 8) {
                CallButton(title: "Микрофон", icon: call.muted ? "mic.slash.fill" : "mic.fill", color: call.muted ? .pink : Brand.online, filled: !call.muted) { call.setMuted(!call.muted) }
                    .accessibilityIdentifier("call.microphone")
                CallButton(title: "Камера", icon: call.cameraOn ? "video.fill" : "video.slash.fill", color: call.cameraOn ? Brand.accent : .pink) { Task { await call.toggleCamera() } }
                    .accessibilityIdentifier("call.camera")
                    .disabled(call.cameraBusy)
                CallButton(title: "Ещё", icon: "ellipsis", color: .white) { more = true }
                CallButton(title: "Выйти", icon: "rectangle.portrait.and.arrow.right", color: .white, destructive: true) { call.end() }
                    .accessibilityIdentifier("call.end")
            }
            .frame(maxWidth: 300).padding(.top, 4)
        }
        .padding(.horizontal, 16).padding(.top, 8).frame(maxWidth: 900)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.background)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.28), value: videoMode)
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.88), value: focusedID)
        .task(id: hasVideo) {
            if hasVideo { videoMode = true }
            else {
                try? await Task.sleep(for: .milliseconds(550))
                guard !Task.isCancelled else { return }
                focusedID = nil; videoMode = false
            }
        }
        .sheet(isPresented: $more) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Настройки звонка").font(.title2.bold())
                #if os(iOS)
                Button { account.calls.toggleSpeaker() } label: {
                    Label(account.calls.speaker ? "Динамик включён" : "Разговорный динамик", systemImage: account.calls.speaker ? "speaker.wave.2.fill" : "ear")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                #endif
                Toggle("Зеркалить свою камеру", isOn: $mirrorSelf)
                Text("Другие участники видят камеру без зеркального отражения.").font(.caption).foregroundStyle(Brand.muted)
                ShareLink(item: URL(string: "https://trlka.com/join/\(account.calls.roomID)")!) { Label("Поделиться комнатой", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading) }
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
    var side: CGFloat = 170
    var tileSize: CGSize?
    var compact = false
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        let call = account.calls
        let screen = call.video(participantID: participant.id, source: "screen")
        let video = screen ?? call.video(participantID: participant.id)
        ZStack {
            LinearGradient(colors: [Brand.surface, Brand.background], startPoint: .topLeading, endPoint: .bottomTrailing)
            VStack(spacing: compact ? 4 : side < 150 ? 6 : 10) {
                ProfileAvatar(name: participant.name, url: participant.avatar, client: account.client, size: compact ? 26 : min(96, side * 0.32))
                identity.font(.system(size: compact ? 10 : side < 150 ? 12 : 14, weight: .semibold))
                if !compact && side >= 150 { Text(call.connectionState(participant.id)).font(.system(size: 11)).foregroundStyle(Brand.muted).lineLimit(1) }
                if !compact { activity }
            }.padding(compact ? 6 : 12).opacity(video == nil ? 1 : 0)
            if let video {
                RTCVideoSurface(track: video, mirrored: screen == nil && participant.id == call.selfID && mirrorSelf)
                    #if os(macOS)
                    .scaleEffect(x: screen == nil && participant.id == call.selfID && mirrorSelf ? -1 : 1, y: 1)
                    #endif
                    .frame(width: tileSize?.width ?? side, height: tileSize?.height ?? side).clipped().allowsHitTesting(false)
                    .transition(.opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.97)))
                VStack { Spacer(); HStack { identity.font(.system(size: compact ? 10 : 12, weight: .semibold)); Spacer(minLength: 4); if !compact { activity } }.padding(compact ? 6 : 10).background(LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)) }
                    .transition(.opacity)
            }
        }
        .frame(width: tileSize?.width ?? side, height: tileSize?.height ?? side)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.accent.opacity(call.participants.count == 1 ? (pulse ? 0.55 : 0.12) : 0.2), lineWidth: 1))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.26), value: video?.trackId)
        .accessibilityIdentifier("call.participant.\(participant.id)")
        .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true } } }
    }
    private var identity: some View {
        HStack(spacing: 4) {
            Text(participant.name).lineLimit(1)
            if participant.id == account.calls.selfID { Text("вы").font(.system(size: 9, weight: .bold)).foregroundStyle(Brand.muted) }
            if participant.isOwner { Image(systemName: "crown.fill").font(.system(size: 10)).foregroundStyle(.yellow) }
        }
    }
    private var activity: some View {
        Group {
            if participant.muted { Image(systemName: "mic.slash.fill").foregroundStyle(Color.pink) }
            else {
                HStack(spacing: 3) {
                    ForEach(0..<4) { index in
                        RoundedRectangle(cornerRadius: 2).fill(Brand.accent)
                            .frame(width: 3, height: 3 + min(1, account.calls.level(participant.id) * 6) * [12.0, 20.0, 16.0, 9.0][index])
                    }
                }.frame(width: 24, height: 22).animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: account.calls.level(participant.id))
            }
        }
    }
}

struct CallButton: View {
    let title: String
    let icon: String
    let color: Color
    var destructive = false
    var filled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 19, weight: .medium))
                Text(title).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .foregroundStyle(filled ? Color.black : color).frame(maxWidth: .infinity).frame(height: 54)
            .background(destructive ? Color(red: 0.91, green: 0.19, blue: 0.36) : filled ? color : color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.15), lineWidth: 1))
        }.buttonStyle(CompactControlStyle()).accessibilityLabel(title)
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
                            do { let receipts = try await account.client.invite(roomID: account.calls.roomID, userIDs: [friend.id]); account.calls.noteInvitation(friend, receipts: receipts); dismiss() }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack { ProfileAvatar(name: friend.display_name, url: friend.avatarUrl, client: account.client); Text(friend.display_name); Spacer(); Image(systemName: "phone.badge.plus") }
                    }.disabled(working || account.calls.participants.contains(where: { $0.accountId == friend.id }) || account.calls.waiting.contains(where: { $0.id == friend.id }))
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
