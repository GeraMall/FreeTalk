import SwiftUI

struct LoginView: View {
    let account: AccountStore
    @State private var login = ""
    @State private var password = ""
    @State private var visiblePassword = false
    @State private var resetEmail = ""
    @State private var resetting = false
    @State private var resetMessage: String?
    @State private var resetWorking = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                HStack(spacing: 12) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 56, height: 56)
                    Text("TRLKA").font(.largeTitle.bold())
                }
                SectionCaption(text: "СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!")
                VStack(alignment: .leading, spacing: 16) {
                    TextField("Почта или @username", text: $login)
                        .textContentType(.username)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        #endif
                    HStack {
                        Group {
                            if visiblePassword { TextField("Пароль", text: $password) }
                            else { SecureField("Пароль", text: $password) }
                        }
                        .textContentType(.password)
                        Button { visiblePassword.toggle() } label: {
                            Image(systemName: visiblePassword ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(visiblePassword ? "Скрыть пароль" : "Показать пароль")
                    }
                    if let error = account.error {
                        Text(error).font(.callout).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently)
                    }
                    Button {
                        Task {
                            await account.login(login: login, password: password)
                            if account.user != nil { password = "" }
                        }
                    } label: {
                        HStack {
                            if account.working { ProgressView().controlSize(.small) }
                            Text("Войти").bold()
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.black)
                    }
                    .buttonStyle(.plain)
                    .disabled(account.working || login.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                    Button("Забыли пароль?") { resetting = true }.frame(maxWidth: .infinity)
                }
                .textFieldStyle(.roundedBorder)
                HStack(spacing: 12) {
                    Image(systemName: "shield.lefthalf.filled").foregroundStyle(Brand.cyan)
                    Text("Приватная связь. Разговоры идут через WebRTC.")
                        .font(.caption).foregroundStyle(Brand.muted)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading).trlkaPanel(14)
            }
            .padding(24).frame(maxWidth: 440).trlkaPanel(24).padding(20).frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $resetting) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Восстановление доступа").font(.title2.bold())
                TextField("Почта аккаунта", text: $resetEmail).textFieldStyle(.roundedBorder)
                    .textContentType(.emailAddress)
                    #if os(iOS)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    #endif
                if let resetMessage { Text(resetMessage).font(.callout) }
                Button("Отправить код") {
                    resetWorking = true
                    Task {
                        defer { resetWorking = false }
                        do {
                            try await account.client.forgotPassword(email: resetEmail.trimmingCharacters(in: .whitespaces))
                            resetMessage = "Если аккаунт существует, письмо придёт на почту. Завершить сброс пока можно в TRLKA для Windows или в браузере."
                        } catch { resetMessage = error.localizedDescription }
                    }
                }.disabled(resetEmail.isEmpty || resetWorking)
                Button("Закрыть") { resetting = false }
            }.padding(28).frame(idealWidth: 420)
                .presentationDetents([.medium])
        }
    }
}
