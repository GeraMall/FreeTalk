import SwiftUI
import WebKit

/// The challenge lives in a separate ephemeral view and receives no login or registration data.
struct CaptchaSheet: View {
    let solved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var attempt = UUID()
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                ChallengeWidget { token in
                    if let token { solved(token) }
                    else { error = "Проверка не завершена. Попробуйте ещё раз." }
                }.id(attempt).frame(maxWidth: .infinity, minHeight: 180)
                if let error { Text(error).font(.callout).foregroundStyle(.red) }
                Button("Повторить проверку") { error = nil; attempt = UUID() }
            }.padding().navigationTitle("Проверка безопасности")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
}

private struct ChallengeWidget {
    let complete: (String?) -> Void
    static let origin = URL(string: "https://trlka.com/")!
    // The public production widget key used by the desktop client.
    static let siteKey = "0x4AAAAAAEb4WzcVqGSy9mKO"

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        var active = true
        let complete: (String?) -> Void
        init(_ complete: @escaping (String?) -> Void) { self.complete = complete }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            let origin = message.frameInfo.securityOrigin
            guard active, message.frameInfo.isMainFrame, origin.protocol == "https", origin.host == "trlka.com",
                  [0, 443].contains(origin.port), let result = message.body as? [String: String], result["nonce"] == nonce else { return }
            if let token = result["token"], !token.isEmpty, token.utf8.count <= 2048 {
                active = false
                complete(token)
            } else { complete(nil) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, let frame = navigationAction.targetFrame else { decisionHandler(.cancel); return }
            let blank = ["about:blank", "about:srcdoc"].contains(url.absoluteString)
            if frame.isMainFrame {
                decisionHandler(navigationAction.navigationType == .other && (url == ChallengeWidget.origin || blank) ? .allow : .cancel)
            } else {
                let provider = url.scheme == "https" && url.host == "challenges.cloudflare.com" && (url.port == nil || url.port == 443)
                decisionHandler(provider || blank ? .allow : .cancel)
            }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if active && (error as NSError).code != NSURLErrorCancelled { complete(nil) }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if active { complete(nil) } }
    }

    func makeCoordinator() -> Coordinator { Coordinator(complete) }
    func makeView(_ delegate: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(delegate, name: "proof")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = delegate
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-\(delegate.nonce)' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <style>:root{color-scheme:light dark}body{margin:4px}</style></head><body><div id="challenge"></div>
        <script nonce="\(delegate.nonce)">
        const send = token => window.webkit.messageHandlers.proof.postMessage({nonce:"\(delegate.nonce)",token:token || ""});
        const ready = () => turnstile.render("#challenge",{sitekey:"\(Self.siteKey)",size:"flexible",callback:send,
          "error-callback":()=>send(""),"expired-callback":()=>send(""),"timeout-callback":()=>send("")});
        window.challengeReady=ready;
        const loader=document.createElement("script");
        loader.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=challengeReady";
        loader.onerror=()=>send(""); document.head.appendChild(loader);
        </script></body></html>
        """
        view.loadHTMLString(html, baseURL: Self.origin)
        return view
    }
    static func finish(_ view: WKWebView, _ coordinator: Coordinator) {
        coordinator.active = false
        view.configuration.userContentController.removeScriptMessageHandler(forName: "proof")
        view.navigationDelegate = nil
        view.stopLoading()
    }
}

#if os(iOS)
extension ChallengeWidget: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { finish(view, coordinator) }
}
#elseif os(macOS)
extension ChallengeWidget: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) { finish(view, coordinator) }
}
#endif
