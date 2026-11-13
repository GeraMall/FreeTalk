import SwiftUI
import AVFoundation

struct ProfileView: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false
    #if os(iOS)
    @State private var scanLogin = false
    #endif
    @State private var editing = false
    @State private var name = ""
    @State private var bio = ""
    @State private var error: String?
    @State private var working = false
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    @AppStorage("trlka.chatTextScale") private var textScale = 1.0
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 10) {
                        NavigationLink { profilePage } label: { settingsRow("Профиль", icon: "person", description: "Имя, аватар и информация о себе") }
                        NavigationLink { AppearancePage(account: account) } label: { settingsRow("Интерфейс", icon: "circle.lefthalf.filled", description: "Тема приложения и синхронизация") }
                        NavigationLink { videoPage } label: { settingsRow("Видео и звук", icon: "video", description: "Предпросмотр камеры") }
                        NavigationLink { devicesPage } label: { settingsRow("Устройства", icon: "hifispeaker", description: "Текущий аудиомаршрут") }
                        NavigationLink { chatsPage } label: { settingsRow("Чаты", icon: "bubble.left", description: "Оформление сообщений") }
                        #if os(iOS)
                        Button { scanLogin = true } label: {
                            settingsRow("Сканировать QR для входа", icon: "qrcode.viewfinder", description: "Войти в TRLKA на компьютере")
                        }
                        #endif
                        NavigationLink { aboutPage } label: { settingsRow("О приложении", icon: "info.circle", description: "Версия и информация") }
                    }.buttonStyle(.plain).padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
                }
                Button(role: .destructive) { confirmLogout = true } label: {
                    Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(15).webPanel(12)
                }.buttonStyle(.plain).disabled(account.working).padding(16)
            }.background(Brand.webBackground).navigationTitle("Настройки")
                .toolbar { ToolbarItem { Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Закрыть настройки").accessibilityIdentifier("settings.done") } }
                .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                    Button("Выйти", role: .destructive) { Task { await account.logout(); dismiss() } }
                }
                .sheet(isPresented: $editing) { editPage }
                #if os(iOS)
                .sheet(isPresented: $scanLogin) { QRLoginScanner(account: account) }
                #endif
        }.presentationDetents([.large])
    }
    private var profilePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    ProfileCover(url: account.user?.coverUrl, client: account.client)
                        .overlay(alignment: .bottomLeading) { ProfileAvatar(name: account.user?.displayName ?? "", url: account.user?.avatarUrl, client: account.client, size: 72).offset(x: 16, y: 24) }.padding(.bottom, 24)
                    Text(account.user?.displayName ?? "").font(.system(size: 24, weight: .bold)).padding(.horizontal, 16)
                    HStack(spacing: 6) { Text("@\(account.user?.username ?? "")").foregroundStyle(Brand.muted); Text("· В сети").foregroundStyle(Brand.online) }.font(.caption).padding(.horizontal, 16)
                    if let bio = account.user?.bio, !bio.isEmpty { Text(bio).font(.subheadline).padding(.horizontal, 16) }
                }.padding(.bottom, 18).webPanel(20)
                Button { name = account.user?.displayName ?? ""; bio = account.user?.bio ?? ""; editing = true } label: { settingsRow("Редактировать профиль", icon: "pencil", description: "Имя и информация о себе") }.buttonStyle(.plain)
            }.padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground).navigationTitle("Ваш профиль")
    }
    private var videoPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Toggle("Зеркалить свою камеру", isOn: $mirrorSelf).font(.subheadline).tint(Brand.accent)
                Text("Настройка меняет только ваш предпросмотр. Собеседники видят обычное изображение.").font(.caption).foregroundStyle(Brand.muted)
            }.padding(18).webPanel().padding(16)
        }.background(Brand.webBackground).navigationTitle("Видео и звук")
    }
    private var devicesPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("Устройства сейчас", systemImage: "hifispeaker").font(.headline)
                #if os(iOS)
                ForEach(AVAudioSession.sharedInstance().currentRoute.inputs, id: \.uid) { device in Label(device.portName, systemImage: "mic") }
                ForEach(AVAudioSession.sharedInstance().currentRoute.outputs, id: \.uid) { device in Label(device.portName, systemImage: "speaker.wave.2") }
                #else
                Text("Системные устройства macOS").font(.subheadline)
                #endif
                Text("Подключённые наушники и Bluetooth-устройства выбираются через управление звуком системы.").font(.caption).foregroundStyle(Brand.muted)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).webPanel().padding(16)
        }.background(Brand.webBackground).navigationTitle("Устройства")
    }
    private var chatsPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Размер текста").font(.headline)
                Slider(value: $textScale, in: 0.9...1.3, step: 0.1).tint(Brand.accent)
                Text("\(Int((14 * textScale).rounded())) pt").font(.caption).foregroundStyle(Brand.muted)
                WebMessageBubble(text: "Привет! Как дела?", date: nil, own: false)
                HStack { Spacer(); WebMessageBubble(text: "Всё отлично, созвонимся?", date: nil, own: true) }
            }.padding(18).webPanel().padding(16)
        }.background(Brand.webBackground).navigationTitle("Чаты")
    }
    private var aboutPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack { Image("BrandMark").resizable().scaledToFit().frame(width: 44, height: 44); Text("TRLKA").font(.title2.bold()) }
                Text("Версия \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—") · beta \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")").font(.subheadline).foregroundStyle(Brand.muted)
                Text("Входящие звонки доступны, пока приложение открыто. Уведомления через Apple Push пока не подключены.").font(.caption).foregroundStyle(Brand.muted)
            }.padding(18).webPanel().padding(16)
        }.background(Brand.webBackground).navigationTitle("О приложении")
    }
    private var editPage: some View {
        NavigationStack {
            Form {
                TextField("Имя", text: $name).webInput()
                TextField("О себе", text: $bio, axis: .vertical).lineLimit(3...6).webInput()
                if let error { Text(error).foregroundStyle(.red) }
            }.scrollContentBackground(.hidden).background(Brand.webBackground).navigationTitle("Профиль")
                .toolbar {
                    ToolbarItem { Button("Отмена") { editing = false } }
                    ToolbarItem { Button("Сохранить") {
                        working = true
                        Task { defer { working = false }; do { account.user = try await account.client.updateProfile(displayName: name, bio: bio); editing = false } catch { self.error = error.localizedDescription } }
                    }.disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty) }
                }
        }.presentationDetents([.medium, .large])
    }
    private func settingsRow(_ title: String, icon: String, description: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).foregroundStyle(Brand.accent).frame(width: 25)
            VStack(alignment: .leading, spacing: 4) { Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary); Text(description).font(.system(size: 11)).foregroundStyle(Brand.muted) }
            Spacer(minLength: 0); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Brand.muted)
        }.padding(15).webPanel(14)
    }
}
