import SwiftUI

struct LoginView: View {
    let account: AccountStore
    @State private var login = ""
    @State private var password = ""
    @State private var visiblePassword = false
    @State private var form: AccountFormMode?
    @State private var notice: String?

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
                        .webInput()
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
                    }.webInput()
                    if let notice { Text(notice).font(.callout).foregroundStyle(Brand.online) }
                    if let error = account.error {
                        Text(error).font(.callout).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently)
                    }
                    Button {
                        Task {
                            notice = nil
                            await account.login(login: login, password: password)
                            if account.needsEmailVerification { form = .verify }
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
                    Button("Создать аккаунт") { form = .register }.frame(maxWidth: .infinity)
                    Button("Забыли пароль?") { form = .requestReset }.frame(maxWidth: .infinity)

                }
                HStack(spacing: 12) {
                    Image(systemName: "shield.lefthalf.filled").foregroundStyle(Brand.accent)
                    Text("Приватная связь. Разговоры идут через WebRTC.")
                        .font(.caption).foregroundStyle(Brand.muted)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading).webPanel(14)
            }
            .padding(24).frame(maxWidth: 440).webPanel(24).padding(20).frame(maxWidth: .infinity)
        }
        .sheet(item: $form) { mode in
            AccountForm(account: account, initial: mode, email: login.contains("@") && !login.hasPrefix("@") ? login : "") { address in
                login = address
                password = ""
                account.error = nil
                notice = "Пароль изменён. Войдите с новым паролем."
                form = nil
            }
        }
    }
}
