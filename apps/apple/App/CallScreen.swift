import SwiftUI
import WebRTC
import TRLKACore

struct CallScreen: View {
    let account: AccountStore
    @State private var more = false
    @State private var invite = false
    @State private var showChat = false
    @State private var videoMode = false
    @State private var focus: CallMediaFocus?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    var body: some View {
        let call = account.calls
        let hasVideo = call.participants.contains { call.video(participantID: $0.id) != nil || call.video(participantID: $0.id, source: "screen") != nil }
        #if os(iOS)
        let wideLayout = horizontalSizeClass == .regular
        #else
        let wideLayout = false
        #endif
        let presentationID = focus?.screenParticipantID
        let presenter = call.participants.first { $0.id == presentationID }
        let sharedTrackID = presentationID.flatMap { call.video(participantID: $0, source: "screen")?.trackId }
        let presentation = presentationID != nil
        let showTileGrid = presentation || videoMode || (wideLayout && (!call.participants.isEmpty || !call.waiting.isEmpty))
        ZStack {
            (presentation ? Color.black : Brand.background).ignoresSafeArea()
            VStack(spacing: 16) {
                if focus == nil || !showTileGrid { callHeader(call) }
                ZStack {
                    if showTileGrid {
                        VideoCallCanvas(account: account, mirrorSelf: mirrorSelf, focus: $focus)
                            .transition(.opacity)
                    } else {
                        audioList(call).transition(.opacity)
                    }
                }
                if !presentation { callControls(call) }
            }
            .padding(.horizontal, presentation ? 0 : 16)
            .padding(.top, presentation ? 0 : 8)
            .frame(maxWidth: presentation ? .infinity : 900)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea(presentation ? .container : [])
            #if os(iOS)
            if presentation { presentationControls(call, presenter: presenter) }
            #endif
        }
        #if os(iOS)
        .statusBarHidden(presentation)
        #endif
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.24), value: showTileGrid)
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.88), value: focus)
        .onChange(of: showTileGrid) { _, show in
            if !show { focus = nil }
        }
        .onChange(of: sharedTrackID) { _, track in
            if track == nil && focus?.screenParticipantID != nil { focus = nil }
        }
        .task(id: hasVideo) {
            if hasVideo { videoMode = true }
            else {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 260))
                guard !Task.isCancelled else { return }
                if !wideLayout { focus = nil }
                videoMode = false
            }
        }
        .sheet(isPresented: $more) { callOptions(call) }
        .sheet(isPresented: $showChat) {
            CallChatSheet(account: account)
        }
        .sheet(isPresented: $invite) { InviteToCallScreen(account: account) }
        #if os(iOS)
        .fullScreenCover(isPresented: Binding(get: { call.tabletPresented }, set: { if !$0 { call.closeTablet() } })) {
            CallTabletScreen(call: call, client: account.client)
        }
        #endif
        .alert("Звонок", isPresented: Binding(get: { call.error != nil }, set: { if !$0 { call.error = nil } })) {
            Button("Понятно") { call.error = nil }
        } message: { Text(call.error ?? "") }
    }

    #if os(iOS)
    private func presentationControls(_ call: CallController, presenter: RoomParticipant?) -> some View {
        VStack {
            HStack(spacing: 10) {
                Button { focus = nil } label: {
                    Image(systemName: "arrow.down.right.and.arrow.up.left").frame(width: 44, height: 44)
                }
                .buttonStyle(CompactControlStyle())
                .accessibilityLabel("Закрыть полноэкранный просмотр")
                .accessibilityIdentifier("call.close-presentation")
                VStack(alignment: .leading, spacing: 3) {
                    Text("Демонстрация экрана").font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("call.presentation")
                    if let presenter { Text(presenter.name).font(.caption).foregroundStyle(Brand.muted).lineLimit(1) }
                }
                Spacer(minLength: 4)
                chatButton(call)
            }
            .padding(.trailing, 6)
            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 14))
            Spacer(minLength: 0)
            callControls(call)
                .padding(6)
                .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .accessibilityAction(.escape) { focus = nil }
    }
    #endif

    private func callOptions(_ call: CallController) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Настройки звонка").font(.title2.bold())
                #if os(iOS)
                Button {
                    more = false
                    call.toggleScreen()
                } label: {
                    Label(call.sharingScreen ? "Остановить показ TRLKA" : "Показать экран TRLKA", systemImage: "rectangle.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .disabled(call.screenBusy || call.selfID.isEmpty)
                .accessibilityIdentifier("call.screen-share")
                Toggle("Отключить звук звонка", isOn: Binding(get: { call.deafened }, set: { call.setDeafened($0) }))
                Button { account.calls.toggleSpeaker() } label: {
                    Label(account.calls.speaker ? "Динамик включён" : "Разговорный динамик", systemImage: account.calls.speaker ? "speaker.wave.2.fill" : "ear")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                #endif
                #if DEBUG
                if PreviewFixtures.mode == "call-screen" {
                    Button("Остановить тестовый показ") { call.stopPreviewScreen(); more = false }
                        .accessibilityIdentifier("call.stop-preview-screen")
                }
                #endif
                Toggle("Зеркалить свою камеру", isOn: $mirrorSelf)
                Text("Другие участники видят камеру без зеркального отражения.").font(.caption).foregroundStyle(Brand.muted)
                ShareLink(item: URL(string: "https://trlka.com/join/\(account.calls.roomID)")!) { Label("Поделиться комнатой", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading) }
                Text("Код комнаты: \(account.calls.roomID)").font(.callout.monospaced()).textSelection(.enabled)
                Button("Готово") { more = false }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
        }.accessibilityIdentifier("call.options").presentationDetents([.large])
    }

    private func callHeader(_ call: CallController) -> some View {
        VStack(spacing: 16) {
            HStack(spacing: 14) {
                Button { call.presented = false } label: {
                    Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44).trlkaPanel(14)
                }
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
                chatButton(call)
                Button { invite = true } label: { Label("Добавить", systemImage: "person.badge.plus").font(.caption.weight(.semibold)) }
                    .buttonStyle(.bordered).disabled(call.participants.count >= 8 || call.roomID.isEmpty)
            }
        }
    }

    private func chatButton(_ call: CallController) -> some View {
        Button { showChat = true } label: {
            Image(systemName: "bubble.left.and.bubble.right").frame(minWidth: 36, minHeight: 32)
        }
        .buttonStyle(.bordered).accessibilityLabel("Открыть чат звонка")
        .accessibilityIdentifier("call.chat").disabled(call.roomID.isEmpty)
    }

    private func audioList(_ call: CallController) -> some View {
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

    private func callControls(_ call: CallController) -> some View {
        VStack(spacing: 16) {
            #if os(iOS)
            if call.sharingScreen {
                Button { call.toggleScreen() } label: {
                    Label("Остановить показ TRLKA", systemImage: "stop.circle.fill")
                }.buttonStyle(.bordered).tint(.red).accessibilityIdentifier("call.stop-screen-share")
            }
            #endif
            HStack(spacing: 8) {
                CallButton(title: "Микрофон", icon: call.muted ? "mic.slash.fill" : "mic.fill", color: call.muted ? .pink : Brand.online, highlighted: !call.muted) { call.setMuted(!call.muted) }
                    .accessibilityIdentifier("call.microphone")
                CallButton(title: "Камера", icon: call.cameraOn ? "video.fill" : "video.slash.fill", color: call.cameraOn ? Brand.accent : .pink) { Task { await call.toggleCamera() } }
                    .accessibilityIdentifier("call.camera")
                    .accessibilityValue(call.cameraOn ? "Включена" : "Выключена").disabled(call.cameraBusy)
                #if os(iOS)
                CallButton(title: "Игры", icon: "gamecontroller", color: Brand.accent, highlighted: call.tablet?["open"] as? Bool == true) { call.openTablet() }
                    .disabled(call.tablet == nil || call.phase == .reconnecting).accessibilityIdentifier("call.tablet")
                #endif
                CallButton(title: "Ещё", icon: "ellipsis", color: .primary) { more = true }
                    .accessibilityIdentifier("call.more")
                CallButton(title: "Выйти", icon: "rectangle.portrait.and.arrow.right", color: .white, destructive: true) { call.end() }
                    .accessibilityIdentifier("call.end")
            }.frame(maxWidth: 370).padding(.top, 4)
        }
    }
}

struct ParticipantCard: View {
    let participant: RoomParticipant
    let account: AccountStore
    let mirrorSelf: Bool
    var side: CGFloat = 170
    var tileSize: CGSize?
    var compact = false
    var expanded = false
    var presentation = false
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        let call = account.calls
        let screen = call.video(participantID: participant.id, source: "screen")
        let video = presentation ? screen : screen ?? call.video(participantID: participant.id)
        ZStack {
            if presentation {
                Color.black
            } else {
                LinearGradient(colors: [Brand.surface, Brand.background], startPoint: .topLeading, endPoint: .bottomTrailing)
                VStack(spacing: compact ? 4 : side < 150 ? 6 : 10) {
                    ProfileAvatar(name: participant.name, url: participant.avatar, client: account.client, size: compact ? 26 : min(96, side * 0.32))
                    identity.font(.system(size: compact ? 10 : side < 150 ? 12 : 14, weight: .semibold))
                    if !compact && side >= 150 { Text(call.connectionState(participant.id)).font(.system(size: 11)).foregroundStyle(Brand.muted).lineLimit(1) }
                    if !compact { activity }
                }.padding(compact ? 6 : 12)
            }
            if let video {
                let mirrored = screen == nil && participant.id == call.selfID && mirrorSelf
                Group {
                    #if os(iOS)
                    FadingVideoSurface(track: video, mirrored: mirrored, fillsTile: screen == nil && !expanded)
                        .id(video.trackId)
                    #else
                    RTCVideoSurface(track: video, mirrored: mirrored)
                        .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                        .background(.black)
                    #endif
                }
                .frame(width: tileSize?.width ?? side, height: tileSize?.height ?? side).clipped().allowsHitTesting(false)
                .transition(.opacity)
                if !presentation {
                    VStack { Spacer(); HStack { identity.font(.system(size: compact ? 10 : 12, weight: .semibold)); Spacer(minLength: 4); if !compact { activity } }.padding(compact ? 6 : 10).background(LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)) }
                        .transition(.opacity)
                }
            }
        }
        .frame(width: tileSize?.width ?? side, height: tileSize?.height ?? side)
        .clipShape(RoundedRectangle(cornerRadius: presentation ? 0 : 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.accent.opacity(presentation ? 0 : call.participants.count == 1 ? (pulse ? 0.55 : 0.12) : 0.2), lineWidth: 1))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.26), value: video?.trackId)
        .accessibilityElement(children: .ignore)
        .contentShape(.accessibility, RoundedRectangle(cornerRadius: presentation ? 0 : 20))
        .accessibilityLabel(spokenIdentity)
        .accessibilityValue(video == nil ? "Без видео" : screen != nil ? "Демонстрация экрана" : "Камера")
        .accessibilityIdentifier("call.participant.\(participant.id)")
        .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { pulse = true } } }
    }
    private var spokenIdentity: String {
        var parts = [participant.name]
        let isSelf = participant.id == account.calls.selfID
        if isSelf { parts.append("Вы") }
        if participant.isOwner { parts.append("Ведущий звонка") }
        if participant.deafened == true { parts.append("Звук звонка выключен") }
        else if participant.muted { parts.append("Микрофон выключен") }
        else if !isSelf { parts.append(account.calls.connectionState(participant.id)) }
        return parts.joined(separator: ", ")
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
            if participant.deafened == true { Image(systemName: "speaker.slash.fill").foregroundStyle(Color.pink).accessibilityLabel("Звук звонка выключен") }
            else if participant.muted { Image(systemName: "mic.slash.fill").foregroundStyle(Color.pink).accessibilityLabel("Микрофон выключен") }
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
    var highlighted = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 19, weight: .medium))
                Text(title).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .foregroundStyle(color).frame(maxWidth: .infinity).frame(height: 54)
            .background(destructive ? Color(red: 0.91, green: 0.19, blue: 0.36) : color.opacity(highlighted ? 0.16 : 0.1), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(highlighted ? 0.38 : 0.15), lineWidth: 1))
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
private struct FadingVideoSurface: View {
    let track: RTCVideoTrack
    let mirrored: Bool
    let fillsTile: Bool
    @State private var ready = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RTCVideoSurface(track: track, mirrored: mirrored, fillsTile: fillsTile) {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { ready = true }
        }
        .background(.black)
        .opacity(ready ? 1 : 0)
    }
}

private struct RTCVideoSurface: UIViewRepresentable {
    let track: RTCVideoTrack
    let mirrored: Bool
    let fillsTile: Bool
    let onFirstFrame: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView(frame: .zero)
        configure(view, coordinator: context.coordinator)
        return view
    }
    func updateUIView(_ view: RTCMTLVideoView, context: Context) {
        configure(view, coordinator: context.coordinator)
    }
    private func configure(_ view: RTCMTLVideoView, coordinator: Coordinator) {
        let mode: UIView.ContentMode = fillsTile ? .scaleAspectFill : .scaleAspectFit
        if view.videoContentMode != mode { view.videoContentMode = mode }
        let transform = CGAffineTransform(scaleX: mirrored ? -1 : 1, y: 1)
        if view.transform != transform { view.transform = transform }
        coordinator.onFirstFrame = onFirstFrame
        coordinator.attach(track, view)
    }
    static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) { coordinator.detach() }
    final class Coordinator {
        private var track: RTCVideoTrack?
        private var renderer: Renderer?
        var onFirstFrame: (() -> Void)?

        func attach(_ value: RTCVideoTrack, _ view: RTCMTLVideoView) {
            guard track !== value else { return }
            detach()
            let renderer = Renderer(view: view)
            renderer.firstFrame = { [weak self, weak renderer] in
                DispatchQueue.main.async { [weak self, weak renderer] in
                    guard let self, let renderer, self.renderer === renderer else { return }
                    self.onFirstFrame?()
                }
            }
            track = value
            self.renderer = renderer
            value.add(renderer)
        }

        func detach() {
            if let renderer { track?.remove(renderer) }
            track = nil
            renderer = nil
        }
    }

    private final class Renderer: NSObject, RTCVideoRenderer {
        private weak var view: RTCMTLVideoView?
        private let lock = NSLock()
        var firstFrame: (() -> Void)?

        init(view: RTCMTLVideoView) { self.view = view }
        func setSize(_ size: CGSize) { view?.setSize(size) }
        func renderFrame(_ frame: RTCVideoFrame?) {
            view?.renderFrame(frame)
            guard frame != nil else { return }
            lock.lock()
            let notify = firstFrame
            firstFrame = nil
            lock.unlock()
            notify?()
        }
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
