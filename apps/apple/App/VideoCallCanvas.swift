import SwiftUI
import TRLKACore

struct AudioParticipantRow: View {
    let participant: RoomParticipant
    let account: AccountStore
    var body: some View {
        HStack(spacing: 12) {
            ProfileAvatar(name: participant.name, url: participant.avatar, client: account.client, size: 46)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(participant.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    if participant.id == account.calls.selfID { Text("вы").font(.system(size: 9, weight: .bold)).foregroundStyle(Brand.muted) }
                    if participant.isOwner { Image(systemName: "crown.fill").font(.system(size: 11)).foregroundStyle(.yellow) }
                }
                Text(account.calls.connectionState(participant.id)).font(.system(size: 12)).foregroundStyle(Brand.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            if participant.deafened == true { Image(systemName: "speaker.slash.fill").foregroundStyle(Color.pink).accessibilityLabel("Звук звонка выключен") }
            else if participant.muted { Image(systemName: "mic.slash.fill").foregroundStyle(Color.pink).accessibilityLabel("Микрофон выключен") }
            else {
                HStack(spacing: 3) {
                    ForEach(0..<4) { index in
                        RoundedRectangle(cornerRadius: 2).fill(Brand.accent)
                            .frame(width: 3, height: 3 + min(1, account.calls.level(participant.id) * 6) * [12.0, 20.0, 16.0, 9.0][index])
                    }
                }.frame(width: 24, height: 24)
            }
        }.padding(14).trlkaPanel(18).accessibilityIdentifier("call.participant.\(participant.id)")
    }
}

struct VideoCallCanvas: View {
    let account: AccountStore
    let mirrorSelf: Bool
    @Binding var focusedID: String?
    @State private var secondaryID: String?
    @Namespace private var tiles
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var transition: Animation? { reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.88) }

    var body: some View {
        GeometryReader { geometry in
            let call = account.calls
            ZStack(alignment: .topLeading) {
                if let focused = call.participants.first(where: { $0.id == focusedID }) {
                    ParticipantCard(participant: focused, account: account, mirrorSelf: mirrorSelf,
                                    side: min(geometry.size.width, geometry.size.height), tileSize: geometry.size)
                        .matchedGeometryEffect(id: focused.id, in: tiles)
                    Button {
                        withAnimation(transition) { focusedID = nil; secondaryID = nil }
                    } label: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left").font(.system(size: 18, weight: .semibold))
                            .frame(width: 44, height: 44).background(Brand.background.opacity(0.85), in: RoundedRectangle(cornerRadius: 13))
                    }.padding(10).buttonStyle(CompactControlStyle()).accessibilityLabel("Вернуться к участникам").accessibilityIdentifier("call.return-grid")
                    if call.cameraOn, let mini = miniParticipant(focused: focused) {
                        FloatingCallPreview(participant: mini, account: account, mirrorSelf: mirrorSelf, bounds: geometry.size) {
                            withAnimation(transition) { secondaryID = focused.id; focusedID = mini.id }
                        }
                    }
                } else {
                    let layout = CallTileLayout(width: geometry.size.width, height: geometry.size.height, count: call.participants.count + call.waiting.count)
                    ScrollView {
                        ZStack(alignment: .topLeading) {
                            ForEach(Array(call.participants.enumerated()), id: \.element.id) { index, participant in
                                let frame = layout.frames[index]
                                ParticipantCard(participant: participant, account: account, mirrorSelf: mirrorSelf,
                                                side: min(frame.width, frame.height), tileSize: CGSize(width: frame.width, height: frame.height))
                                    .matchedGeometryEffect(id: participant.id, in: tiles)
                                    .contentShape(RoundedRectangle(cornerRadius: 20))
                                    .onTapGesture {
                                        withAnimation(transition) {
                                            focusedID = participant.id
                                            secondaryID = participant.id == call.selfID ? call.participants.first(where: { $0.id != call.selfID })?.id : call.selfID
                                        }
                                    }
                                    .accessibilityAddTraits(.isButton)
                                    .position(x: frame.x + frame.width / 2, y: frame.y + frame.height / 2)
                            }
                            ForEach(Array(call.waiting.enumerated()), id: \.element.id) { index, person in
                                let frame = layout.frames[call.participants.count + index]
                                WaitingPersonCard(person: person, account: account, side: min(frame.width, frame.height), tileSize: CGSize(width: frame.width, height: frame.height))
                                    .position(x: frame.x + frame.width / 2, y: frame.y + frame.height / 2)
                            }
                        }.frame(width: geometry.size.width, height: layout.canvasHeight)
                    }.scrollDisabled(!layout.needsScroll).scrollIndicators(.hidden).accessibilityIdentifier("call.video-grid")
                }
            }.frame(width: geometry.size.width, height: geometry.size.height)
                .onChange(of: call.participants.map(\.id)) { _, ids in
                    if let focusedID, !ids.contains(focusedID) { withAnimation(transition) { self.focusedID = nil; secondaryID = nil } }
                }
        }
    }
    private func miniParticipant(focused: RoomParticipant) -> RoomParticipant? {
        let id = focused.id == account.calls.selfID ? secondaryID : account.calls.selfID
        return account.calls.participants.first { $0.id == id && $0.id != focused.id }
    }
}

private struct FloatingCallPreview: View {
    let participant: RoomParticipant
    let account: AccountStore
    let mirrorSelf: Bool
    let bounds: CGSize
    let onSwap: () -> Void
    @State private var offset = CGSize.zero
    @State private var scale: CGFloat = 1
    @GestureState private var drag = CGSize.zero
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        let base = min(140, bounds.width * 0.38)
        let maximum = max(64, min(240, min(bounds.width * 0.7, (bounds.height - 24) / 0.75)))
        let width = min(maximum, max(min(96, maximum), base * scale * pinch))
        let height = width * 0.75
        let origin = CGPoint(x: bounds.width - width / 2 - 12, y: height / 2 + 12)
        let center = CGPoint(x: clamp(origin.x + offset.width + drag.width, width / 2 + 8, bounds.width - width / 2 - 8),
                             y: clamp(origin.y + offset.height + drag.height, height / 2 + 8, bounds.height - height / 2 - 8))
        ParticipantCard(participant: participant, account: account, mirrorSelf: mirrorSelf, side: height, tileSize: CGSize(width: width, height: height), compact: true)
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Brand.accent.opacity(0.65), lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
            .gesture(DragGesture(minimumDistance: 6)
                .updating($drag) { value, state, _ in state = value.translation }
                .onEnded { value in
                    offset = CGSize(width: clamp(origin.x + offset.width + value.translation.width, width / 2 + 8, bounds.width - width / 2 - 8) - origin.x,
                                    height: clamp(origin.y + offset.height + value.translation.height, height / 2 + 8, bounds.height - height / 2 - 8) - origin.y)
                })
            .simultaneousGesture(MagnificationGesture()
                .updating($pinch) { value, state, _ in state = value }
                .onEnded { value in scale = min(maximum / base, max(min(96, maximum) / base, scale * value)) })
            .onTapGesture(perform: onSwap)
            .onChange(of: bounds) { _, _ in offset = .zero }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Мини-превью. Нажмите, чтобы поменять местами")
            .accessibilityIdentifier("call.self-preview")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onSwap() }
            .position(center)
    }
    private func clamp(_ value: CGFloat, _ minimum: CGFloat, _ maximum: CGFloat) -> CGFloat { min(maximum, max(minimum, value)) }
}
