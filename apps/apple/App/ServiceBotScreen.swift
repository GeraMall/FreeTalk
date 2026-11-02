import SwiftUI
import TRLKACore

struct ServiceBotScreen: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [ServiceMessage] = []
    @State private var draft = ""
    @State private var search = ""
    @State private var profile = false
    @State private var busy = false
    @State private var error: String?
    @State private var requestID = UUID()
    @State private var lastBody = ""
    @State private var loadID = UUID()
    init(account: AccountStore) {
        self.account = account
        #if DEBUG
        _profile = State(initialValue: PreviewFixtures.mode == "bot-profile")
        #endif
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { dismiss() } label: { Image(systemName: "arrow.left").frame(width: 36, height: 44) }
                    .buttonStyle(.plain).accessibilityLabel("Назад к чатам").accessibilityIdentifier("bot.back")
                Button { profile = true } label: {
                    HStack(spacing: 10) {
                        Image("BrandMark").resizable().scaledToFit().frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack { Text("TRLKA").font(.system(size: 15, weight: .bold)); Text("БОТ").font(.system(size: 9, weight: .bold)).padding(3).background(Brand.accent.opacity(0.2), in: RoundedRectangle(cornerRadius: 4)) }
                            Text("Уведомления и поддержка").font(.system(size: 11)).foregroundStyle(Brand.muted)
                        }
                    }
                }.buttonStyle(.plain).accessibilityLabel("Профиль бота TRLKA")
                Spacer(minLength: 0)
                Button { profile = true } label: { Image(systemName: "sidebar.right").frame(width: 36, height: 44) }.buttonStyle(.plain).accessibilityLabel("Показать профиль бота")
            }.padding(.horizontal, 10).padding(.vertical, 8)
            WebSearchField(placeholder: "Искать в «TRLKA»", text: $search).padding(.horizontal, 12).padding(.bottom, 10)
            GeometryReader { viewport in
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if search.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Image(systemName: "bubble.left.and.text.bubble.right").font(.system(size: 23)).padding(12).webPanel(14)
                                    Text("На связи — TRLKA").font(.system(size: 23, weight: .bold)).foregroundStyle(.white)
                                    Text("Здесь уведомления о звонках, сообщения об ошибках и ваши предложения.").font(.system(size: 13)).foregroundStyle(Brand.muted)
                                }.padding(.vertical, 18)
                            }
                            ForEach(messages) { message in
                                HStack(alignment: .top, spacing: 8) {
                                    if message.author == "user" { Spacer(minLength: 24) }
                                    else { Image("BrandMark").resizable().scaledToFit().frame(width: 28, height: 28) }
                                    WebMessageBubble(text: message.body, date: WireDate.parse(message.created_at), own: message.author == "user")
                                        .frame(maxWidth: min(viewport.size.width * 0.84, 640), alignment: message.author == "user" ? .trailing : .leading)
                                }.id(message.id)
                            }
                            Color.clear.frame(height: 1).id("bot-bottom")
                        }.padding(12)
                    }.scrollDismissesKeyboard(.interactively)
                        .onChange(of: messages.last?.id) { if search.isEmpty { proxy.scrollTo("bot-bottom", anchor: .bottom) } }
                }
            }
            VStack(spacing: 8) {
                if let error { Text(error).font(.caption).foregroundStyle(.pink).frame(maxWidth: .infinity, alignment: .leading) }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { actions }
                    VStack(alignment: .leading, spacing: 6) { HStack(spacing: 6) { action("Сообщить об ошибке", "ladybug", "/bug"); action("Предложить улучшение", "lightbulb", "/idea") }; action("Подписка", "sparkles", "/subscription") }
                }.frame(maxWidth: .infinity, alignment: .leading)
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Сообщение или /help", text: $draft, axis: .vertical).lineLimit(1...5).webInput().accessibilityIdentifier("bot.composer")
                    Button { Task { await send(draft) } } label: { Image(systemName: "paperplane").frame(width: 44, height: 44).foregroundStyle(.black).background(Brand.gradient, in: RoundedRectangle(cornerRadius: 12)) }
                        .buttonStyle(.plain).disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityLabel("Отправить сообщение боту")
                }
            }.padding(12)
        }.background(Brand.chatCanvas).preference(key: ChatDestinationKey.self, value: true)
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .task(id: search) { do { try await Task.sleep(for: .milliseconds(250)) } catch { return }; await load() }
            .task(id: account.revision) { await load() }
            .sheet(isPresented: $profile) { BotProfileScreen() }
    }
    private var actions: some View { Group { action("Сообщить об ошибке", "ladybug", "/bug"); action("Предложить улучшение", "lightbulb", "/idea"); action("Подписка", "sparkles", "/subscription") } }
    private func action(_ title: String, _ icon: String, _ command: String) -> some View {
        Button { Task { await send(command) } } label: { Label(title, systemImage: icon).font(.system(size: 11)).padding(.horizontal, 10).padding(.vertical, 9).webPanel(9) }
            .buttonStyle(.plain).disabled(busy)
    }
    private func load() async {
        let id = UUID(); loadID = id
        do { let result = try await account.client.serviceMessages(search: search); try Task.checkCancellation(); if loadID == id { messages = result; error = nil } }
        catch is CancellationError {} catch { if loadID == id { self.error = error.localizedDescription } }
    }
    private func send(_ text: String) async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !body.isEmpty else { return }
        busy = true; defer { busy = false }
        if lastBody != body { requestID = UUID(); lastBody = body }
        do {
            try await account.client.sendServiceMessage(body, requestID: requestID)
            lastBody = ""; if draft.trimmingCharacters(in: .whitespacesAndNewlines) == body { draft = "" }; await load()
        } catch { self.error = error.localizedDescription }
    }
}

struct BotProfileScreen: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Brand.gradient.opacity(0.35).frame(height: 110).clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(alignment: .bottomLeading) { Image("BrandMark").resizable().scaledToFit().frame(width: 72, height: 72).background(Brand.chatCanvas, in: Circle()).offset(x: 16, y: 25) }.padding(.bottom, 25)
                    Text("TRLKA · БОТ").font(.title2.bold())
                    Label("Официальный служебный чат", systemImage: "checkmark.shield").font(.caption).foregroundStyle(Brand.accent)
                    Text("Уведомления о звонках, сообщения об ошибках и ваши предложения команде TRLKA.").font(.system(size: 14))
                    Divider()
                    Text("/bug — сообщить об ошибке\n/idea — предложить улучшение\n/subscription — подписка\n/cancel — отменить обращение\n/help — помощь").font(.system(size: 14)).lineSpacing(9)
                    Text("Одно предложение за 24 часа. Об ошибках можно сообщать отдельно.").font(.caption).foregroundStyle(Brand.muted)
                }.padding(20).webPanel(18).padding(16)
            }.background(Brand.chatCanvas).navigationTitle("Профиль бота")
                .toolbar { ToolbarItem { Button("Готово") { dismiss() } } }
        }.presentationDetents([.large])
    }
}
