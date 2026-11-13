import SwiftUI
import TRLKACore

enum AccountFormMode: String, Identifiable {
    case register, verify, requestReset, reset
    var id: Self { self }
    var title: String {
        switch self {
        case .register: "Создать аккаунт"
        case .verify: "Подтвердить почту"
        case .requestReset: "Восстановить доступ"
        case .reset: "Новый пароль"
        }
    }
}

struct AccountForm: View {
    let account: AccountStore
    let onReset: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var mode: AccountFormMode
    @State private var email: String
    @State private var username = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var repeatPassword = ""
    @State private var code = ""
    @State private var birthDate = Date()
    @State private var birthdaySelected = false
    @State private var pickingDate = false
    @State private var termsAccepted = false
    @State private var privacyAccepted = false
    @State private var documents: [RegistrationDocument] = []
    @State private var documentIndex: Int?
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?

    init(account: AccountStore, initial: AccountFormMode, email: String, onReset: @escaping (String) -> Void) {
        self.account = account
        self.onReset = onReset
        _mode = State(initialValue: initial)
        _email = State(initialValue: initial == .register ? "" : email)
    }

    private var address: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var valid: Bool {
        guard address.utf16.count <= 254, address.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil else { return false }
        switch mode {
        case .requestReset: return true
        case .verify: return code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil
        case .reset: return code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil && validPasswords
        case .register:
            return documents.count == 2 && termsAccepted && privacyAccepted && birthdaySelected && validPasswords
                && displayName.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 48
                && username.lowercased().range(of: "^[a-z0-9_]{5,24}$", options: .regularExpression) != nil
        }
    }
    private var validPasswords: Bool { Registration.validPassword(password) && password == repeatPassword }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    TextField("Почта", text: $email).textContentType(.emailAddress).webInput()
                        #if os(iOS)
                        .textInputAutocapitalization(.never).keyboardType(.emailAddress).autocorrectionDisabled()
                        #endif
                    if mode == .register {
                        TextField("Уникальный @username", text: $username).webInput()
                            #if os(iOS)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            #endif
                        TextField("Отображаемое имя (необязательно)", text: $displayName).webInput()
                        Button { pickingDate = true } label: {
                            HStack { Text("Дата рождения"); Spacer(); Text(birthdaySelected ? birthDate.formatted(date: .numeric, time: .omitted) : "Выбрать") }
                        }
                    }
                    if mode == .verify || mode == .reset {
                        TextField("Шестизначный код из письма", text: $code).textContentType(.oneTimeCode).webInput()
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                    if mode == .register || mode == .reset {
                        SecureField("Пароль", text: $password).textContentType(.newPassword).webInput()
                        SecureField("Повторите пароль", text: $repeatPassword).textContentType(.newPassword).webInput()
                        Text("От 10 символов, хотя бы одна буква и цифра.").font(.caption).foregroundStyle(Brand.muted)
                    }
                    if mode == .register {
                        if documents.count == 2 {
                            agreement(0, accepted: $termsAccepted)
                            agreement(1, accepted: $privacyAccepted)
                        } else if error == nil { ProgressView("Загружаем условия…") }
                        else { Button("Загрузить условия снова") { Task { await loadDocuments() } } }
                    }
                    if let error { Text(error).foregroundStyle(.red).font(.callout) }
                    if let notice { Text(notice).foregroundStyle(Brand.online).font(.callout) }
                    Button(mode == .requestReset ? "Отправить код" : mode == .reset ? "Сохранить пароль" : mode.title) {
                        Task { await submit() }
                    }.buttonStyle(PrimaryButton()).disabled(!valid || busy).opacity(valid && !busy ? 1 : 0.55)
                    if mode == .requestReset {
                        Button("У меня есть код сброса") { changeMode(.reset) }
                    } else if mode == .verify || mode == .reset {
                        Button("Отправить новый код") { Task { await resend() } }
                            .disabled(address.isEmpty || busy)
                    }
                }.disabled(busy).padding(20).frame(maxWidth: 480).frame(maxWidth: .infinity)
            }
            .background(Brand.webBackground).navigationTitle(mode.title)
            .toolbar { ToolbarItem { Button("Закрыть") { dismiss() }.disabled(busy) } }
            .task { if mode == .register { await loadDocuments() } }
            .sheet(isPresented: $pickingDate) {
                VStack {
                    DatePicker("Дата рождения", selection: $birthDate, in: Self.firstDate...Date(), displayedComponents: .date)
                        #if os(iOS)
                        .datePickerStyle(.wheel)
                        #endif
                    Button("Готово") { birthdaySelected = true; pickingDate = false }.buttonStyle(PrimaryButton())
                }.padding().presentationDetents([.medium])
            }
            .sheet(isPresented: Binding(get: { documentIndex != nil }, set: { if !$0 { documentIndex = nil } })) {
                if let index = documentIndex, documents.indices.contains(index) {
                    ScrollView { VStack(alignment: .leading, spacing: 16) {
                        Text(documents[index].title).font(.title2.bold())
                        Text(documents[index].content)
                        Button("Закрыть") { documentIndex = nil }
                    }.padding() }
                }
            }
        }.interactiveDismissDisabled(busy)
    }

    private static let firstDate = Calendar(identifier: .gregorian).date(from: DateComponents(year: 1900, month: 1, day: 1))!
    private func agreement(_ index: Int, accepted: Binding<Bool>) -> some View {
        HStack {
            Button(documents[index].title) { documentIndex = index }.multilineTextAlignment(.leading)
            Spacer()
            Toggle(documents[index].title, isOn: accepted).labelsHidden()
        }
    }
    private func loadDocuments() async {
        error = nil
        do {
            async let terms = account.client.legalDocument(privacy: false)
            async let privacy = account.client.legalDocument(privacy: true)
            let pair = try await [terms, privacy]
            guard !pair[0].version.isEmpty, pair[0].version == pair[1].version else { throw URLError(.badServerResponse) }
            documents = pair
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func changeMode(_ next: AccountFormMode) { mode = next; error = nil; notice = nil; code = "" }

    @MainActor private func submit() async {
        guard valid, !busy else { return }
        busy = true; error = nil; notice = nil
        defer { busy = false }
        do {
            switch mode {
            case .register:
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.calendar = Calendar(identifier: .gregorian)
                formatter.dateFormat = "yyyy-MM-dd"
                try await account.client.register(Registration(email: address, username: username, displayName: displayName,
                    password: password, birthDate: formatter.string(from: birthDate), legalVersion: documents[0].version,
                    acceptedTerms: termsAccepted, acceptedPrivacy: privacyAccepted))
                password = ""; repeatPassword = ""
                changeMode(.verify)
                notice = "Введите код из письма для подтверждения аккаунта."
            case .verify:
                try await account.verifyEmail(address, code: code)
            case .requestReset:
                try await account.client.forgotPassword(email: address)
                changeMode(.reset)
                notice = "Если аккаунт существует, код придёт на почту."
            case .reset:
                try await account.client.resetPassword(email: address, code: code, password: password)
                onReset(address)
            }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor private func resend() async {
        guard !busy else { return }
        busy = true; error = nil; notice = nil
        defer { busy = false }
        do {
            if mode == .verify { try await account.client.resendVerification(email: address) }
            else { try await account.client.forgotPassword(email: address) }
            code = ""
            notice = "Если код требуется, новое письмо отправлено."
        } catch { self.error = error.localizedDescription }
    }
}
