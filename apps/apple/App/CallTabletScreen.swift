#if os(iOS)
import SwiftUI
import WebKit
import ImageIO
import TRLKACore

/// The web view only receives the game state that signaling filtered for this participant.
struct CallTabletScreen: View {
    let call: CallController
    let client: AccountClient
    @AppStorage("trlka.language") private var language = "ru"
    @AppStorage("trlka.theme") private var theme = "default"
    @State private var failed = false
    @State private var avatars: [String: String] = [:]

    var body: some View {
        Group {
            if failed {
                ContentUnavailableView {
                    Label("Не удалось открыть планшет", systemImage: "gamecontroller")
                } actions: {
                    Button("Повторить") { failed = false }
                    Button("Вернуться в звонок") { call.closeTablet() }
                }
            } else {
                TabletRenderer(call: call, payload: payload, onFailure: { failed = true })
            }
        }
        .background(Brand.background)
        .task(id: call.participants.compactMap(\.avatar)) {
            let sources = Set(call.participants.compactMap(\.avatar))
            avatars = avatars.filter { sources.contains($0.key) }
            for source in sources where avatars[source] == nil {
                if source.hasPrefix("data:image/") && source.utf8.count <= 18_000 {
                    avatars[source] = source
                } else if let address = URL(string: source), let data = try? await client.avatarData(url: address) {
                    guard !Task.isCancelled else { return }
                    let options = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                   kCGImageSourceCreateThumbnailWithTransform: true,
                                   kCGImageSourceThumbnailMaxPixelSize: 56] as CFDictionary
                    guard let image = CGImageSourceCreateWithData(data as CFData, nil),
                          let small = CGImageSourceCreateThumbnailAtIndex(image, 0, options),
                          let jpeg = UIImage(cgImage: small).jpegData(compressionQuality: 0.7),
                          jpeg.count < 13_000 else { continue }
                    avatars[source] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                }
            }
        }
    }

    private var payload: String? {
        guard let activity = call.tablet, activity["open"] as? Bool == true else { return nil }
        let participants: [[String: Any]] = call.participants.map { peer in
            var result: [String: Any] = ["id": peer.id, "name": peer.name, "isOwner": peer.isOwner,
                "muted": peer.muted, "deafened": peer.deafened ?? false, "connectedAt": 0,
                "speaking": !peer.muted && call.level(peer.id) > 0.03]
            result["avatar"] = peer.avatar.flatMap { avatars[$0] }
            return result
        }
        let snapshot: [String: Any] = ["activity": activity, "participants": participants, "selfId": call.selfID,
            "muted": call.muted, "deafened": call.deafened, "language": language,
            "theme": theme]
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}

private struct TabletRenderer: UIViewRepresentable {
    let call: CallController
    let payload: String?
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(call: call, onFailure: onFailure) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        let coordinator = context.coordinator
        config.userContentController.add(coordinator, name: "trlkaTablet")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.navigationDelegate = coordinator
        coordinator.load(view)
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.update(payload) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.stop()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "trlkaTablet")
        view.navigationDelegate = nil
        view.stopLoading()
    }

    @MainActor final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let call: CallController
        private let onFailure: () -> Void
        private weak var view: WKWebView?
        private let page = Bundle.main.url(forResource: "android-tablet", withExtension: "html", subdirectory: "tablet")
        private var ready = false
        private var attached = false
        private var latest: String?
        private var delivered: String?
        private var watchdog: Task<Void, Never>?
        init(call: CallController, onFailure: @escaping () -> Void) { self.call = call; self.onFailure = onFailure }
        func load(_ view: WKWebView) {
            self.view = view
            attached = true
            watchdog = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                guard let self, attached && !ready else { return }
                onFailure()
            }
            guard let page else {
                Task { [weak self] in guard let self, attached else { return }; onFailure() }
                return
            }
            view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
            call.onTabletPointer = { [weak self] event in
                guard let self, ready, let data = try? JSONSerialization.data(withJSONObject: event) else { return }
                evaluate("window.TRLKATablet.pointer(raw)", raw: String(decoding: data, as: UTF8.self))
            }
        }
        func update(_ snapshot: String?) {
            latest = snapshot
            guard ready, let snapshot, snapshot != delivered else { return }
            delivered = snapshot
            evaluate("window.TRLKATablet.receive(raw)", raw: snapshot)
        }
        private func evaluate(_ body: String, raw: String) {
            view?.callAsyncJavaScript(body, arguments: ["raw": raw], in: nil, in: .page) { [weak self] result in
                if case .failure = result, let self, attached { onFailure() }
            }
        }
        func stop() {
            attached = false; ready = false
            watchdog?.cancel()
            call.onTabletPointer = nil
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard attached, message.frameInfo.isMainFrame, let page,
                  message.frameInfo.request.url?.standardizedFileURL == page.standardizedFileURL,
                  let raw = message.body as? String, raw.utf8.count <= 32_768,
                  let body = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else { return }
            switch body["type"] as? String {
            case "ready":
                ready = true; watchdog?.cancel(); update(latest)
            case "close": call.closeTablet()
            case "mute": call.setMuted(!call.muted)
            case "deafen": call.setDeafened(!call.deafened)
            case "action":
                if let action = body["action"] as? [String: Any], action["kind"] is String {
                    call.sendTablet(action)
                }
            default: break
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let page, action.targetFrame?.isMainFrame == true,
                  action.request.url?.standardizedFileURL == page.standardizedFileURL else {
                decisionHandler(.cancel); return
            }
            decisionHandler(.allow)
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if attached { onFailure() } }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if attached { onFailure() }
        }
    }
}
#endif
