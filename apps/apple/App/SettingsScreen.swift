import SwiftUI
import AVFoundation

struct ProfileView: View {
    private enum Section: String {
        case profile = "Профиль"
        case appearance = "Интерфейс"
        case video = "Видео и звуки"
        case devices = "Устройства"
        case chats = "Чаты"
        case about = "О приложении"

        var icon: String {
            switch self {
            case .profile: "person.crop.circle"
            case .appearance: "circle.lefthalf.filled"
            case .video: "video"
            case .devices: "hifispeaker"
            case .chats: "bubble.left"
            case .about: "info.circle"
            }
        }
        var subtitle: String {
            switch self {
            case .profile: "Имя, аватар и информация о себе"
            case .appearance: "Тема приложения и синхронизация"
            case .video: "Предпросмотр камеры"
            case .devices: "Текущий аудиомаршрут"
            case .chats: "Оформление сообщений"
            case .about: "Версия и информация"
            }
        }
    }

    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false
    #if os(iOS)
    @State private var scanLogin = false
    @State private var deleteAccount = false
    #endif
    @State private var editing = false
    @State private var name = ""
    @State private var bio = ""
    @State private var error: String?
    @State private var working = false
    @State private var selectedSection: Section = .profile
    @AppStorage("trlka.mirrorSelfCamera") private var mirrorSelf = true
    @AppStorage("trlka.chatTextScale") private var textScale = 1.0
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                #if os(iOS)
                if geometry.size.width >= 720 {
                    HStack(spacing: 0) {
                        settingsMenu(split: true).frame(width: 305)
                        Rectangle().fill(Brand.webStroke).frame(width: 1)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(LocalizedStringKey(selectedSection.rawValue))
                                .font(.title2.bold())
                                .padding(.horizontal, 20)
                                .padding(.top, 16)
                                .accessibilityAddTraits(.isHeader)
                            page(selectedSection)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                    .accessibilityIdentifier("settings.split")
                } else {
                    settingsMenu(split: false)
                }
                #else
                settingsMenu(split: false)
                #endif
            }.background(Brand.webBackground).navigationTitle("Настройки")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }
                            .accessibilityLabel("Закрыть настройки")
                            .accessibilityIdentifier("settings.done")
                    }
                }
                .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                    Button("Выйти", role: .destructive) { Task { await account.logout(); dismiss() } }
                }
                .sheet(isPresented: $editing) { editPage }
                #if os(iOS)
                .sheet(isPresented: $scanLogin) { QRLoginScanner(account: account) }
                .sheet(isPresented: $deleteAccount) { DeleteAccountScreen(account: account) }
                #endif
        }
    }

    private func settingsMenu(split: Bool) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                VStack(spacing: 0) {
                    sectionRow(.profile, split: split)
                    rowDivider
                    sectionRow(.appearance, split: split)
                }.webPanel(16)
                VStack(spacing: 0) {
                    sectionRow(.video, split: split)
                    rowDivider
                    sectionRow(.devices, split: split)
                    rowDivider
                    sectionRow(.chats, split: split)
                }.webPanel(16)
                VStack(spacing: 0) {
                    #if os(iOS)
                    Button { scanLogin = true } label: {
                        settingsRow("Сканировать QR для входа", icon: "qrcode.viewfinder", description: "Войти в TRLKA на компьютере")
                    }.accessibilityIdentifier("settings.qr")
                    rowDivider
                    #endif
                    sectionRow(.about, split: split)
                }.webPanel(16)
                Button(role: .destructive) { confirmLogout = true } label: {
                    Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .contentShape(Rectangle())
                        .webPanel(14)
                }.disabled(account.working)
            }
            .buttonStyle(CompactControlStyle())
            .padding(16).frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("settings.menu")
    }

    @ViewBuilder private func sectionRow(_ section: Section, split: Bool) -> some View {
        let selected = split && selectedSection == section
        let label = settingsRow(LocalizedStringKey(section.rawValue), icon: section.icon,
                                description: LocalizedStringKey(section.subtitle), selected: selected)
        Group {
            if split {
                Button { selectedSection = section } label: { label }
                    .accessibilityAddTraits(selected ? .isSelected : [])
            } else {
                NavigationLink {
                    page(section).navigationTitle(LocalizedStringKey(section.rawValue))
                        #if os(iOS)
                        .navigationBarTitleDisplayMode(.inline)
                        #endif
                } label: { label }
            }
        }
        .accessibilityIdentifier(section == .appearance ? "settings.appearance" : "settings.\(String(describing: section))")
    }

    private var rowDivider: some View {
        Rectangle().fill(Brand.webStroke).frame(height: 0.5).padding(.leading, 56)
            .accessibilityHidden(true)
    }

    @ViewBuilder private func page(_ section: Section) -> some View {
        switch section {
        case .profile: profilePage
        case .appearance: AppearancePage(account: account)
        case .video: videoPage
        case .devices: devicesPage
        case .chats: chatsPage
        case .about: aboutPage
        }
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
                Button { name = account.user?.displayName ?? ""; bio = account.user?.bio ?? ""; editing = true } label: {
                    settingsRow("Редактировать профиль", icon: "pencil", description: "Имя и информация о себе").webPanel(14)
                }.buttonStyle(CompactControlStyle())
                #if os(iOS)
                Button(role: .destructive) { deleteAccount = true } label: {
                    Label("Удалить аккаунт", systemImage: "trash")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .padding(.horizontal, 14)
                        .contentShape(Rectangle())
                        .webPanel(14)
                }
                .buttonStyle(CompactControlStyle())
                .accessibilityIdentifier("settings.delete-account")
                .disabled(account.working)
                #endif
            }.padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground)
    }
    private var videoPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Toggle("Зеркалить свою камеру", isOn: $mirrorSelf).font(.subheadline).tint(Brand.accent)
                Text("Настройка меняет только ваш предпросмотр. Собеседники видят обычное изображение.").font(.caption).foregroundStyle(Brand.muted)
            }.padding(18).webPanel().padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground)
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
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).webPanel().padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground)
    }
    private var chatsPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Размер текста").font(.headline)
                Slider(value: $textScale, in: 0.9...1.3, step: 0.1).tint(Brand.accent)
                Text("\(Int((14 * textScale).rounded())) pt").font(.caption).foregroundStyle(Brand.muted)
                WebMessageBubble(text: "Привет! Как дела?", date: nil, own: false)
                HStack { Spacer(); WebMessageBubble(text: "Всё отлично, созвонимся?", date: nil, own: true) }
            }.padding(18).webPanel().padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground)
    }
    private var aboutPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack { Image("BrandMark").resizable().scaledToFit().frame(width: 44, height: 44); Text("TRLKA").font(.title2.bold()) }
                Text("Версия \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—") · beta \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")").font(.subheadline).foregroundStyle(Brand.muted)
                Text("Входящие звонки доступны, пока приложение открыто. Уведомления через Apple Push пока не подключены.").font(.caption).foregroundStyle(Brand.muted)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).webPanel().padding(16).frame(maxWidth: 650).frame(maxWidth: .infinity)
        }.background(Brand.webBackground)
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
    private func settingsRow(_ title: LocalizedStringKey, icon: String, description: LocalizedStringKey,
                             selected: Bool = false) -> some View {
        HStack(spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Brand.accent)
                .frame(width: 34, height: 34)
                .background(Brand.accent.opacity(0.11), in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Text(description).font(.caption).foregroundStyle(Brand.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 2)
            Image(systemName: selected ? "checkmark" : "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(selected ? Brand.accent : Brand.muted)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(minHeight: 54)
        .background(selected ? Brand.accent.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
    }
}

#if os(iOS)
private struct DeleteAccountScreen: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirm = false
    @State private var submitting = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Личные данные будут удалены или обезличены, а все сессии завершены.")
                        .font(.subheadline).foregroundStyle(Brand.muted)
                    SecureField("Текущий пароль", text: $password)
                        .textContentType(.password).webInput()
                        .accessibilityIdentifier("delete-account.password")
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.red) }
                    Button(role: .destructive) { confirm = true } label: {
                        HStack(spacing: 8) {
                            if submitting { ProgressView().controlSize(.small) }
                            Text("Удалить аккаунт")
                        }.frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered).tint(.red)
                    .disabled(submitting || password.isEmpty || password.utf16.count > 256)
                    .accessibilityIdentifier("delete-account.review")
                }
                .padding(16).webPanel(16).padding(16)
                .frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            .background(Brand.webBackground)
            .navigationTitle("Удалить аккаунт")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(submitting) } }
            .alert("Удалить аккаунт", isPresented: $confirm) {
                Button("Отмена", role: .cancel) {}
                Button("Удалить навсегда", role: .destructive) {
                    submitting = true
                    failure = nil
                    Task {
                        defer { submitting = false; password = "" }
                        do { try await account.deleteAccount(password: password); dismiss() }
                        catch { failure = error.localizedDescription }
                    }
                }
            } message: {
                Text("Личные данные будут удалены или обезличены, а все сессии завершены.")
            }
        }
        .interactiveDismissDisabled(submitting)
    }
}
#endif
