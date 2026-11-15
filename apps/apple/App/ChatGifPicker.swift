#if os(iOS)
import SwiftUI
import ImageIO
import TRLKACore

struct ChatGifPicker: View {
    enum Selection { case gif(ChatGif), sticker(String) }
    private enum Tab: String, CaseIterable { case search = "GIF", favorites = "Избранное", stickers = "Стикеры" }
    let client: AccountClient
    let send: (Selection) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @AppStorage("trlka.language") private var language = "ru"
    @State private var tab = Tab.search
    @State private var query = ""
    @State private var key: String?
    @State private var ready = false
    @State private var favorites: [ChatGif] = []
    @State private var results: [ChatGif] = []
    @State private var page = 1
    @State private var more = false
    @State private var loading = false
    @State private var sending = false
    @State private var failure: String?
    @State private var retry = 0
    private let stickers = ["😎", "😂", "🔥", "❤️", "🎉", "👋"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Медиатека", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { tab in Text(tab.rawValue).tag(tab) }
                }.pickerStyle(.segmented).padding(.horizontal)
                if tab != .stickers {
                    TextField("Найти GIF", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
                }
                if let failure {
                    Text(failure).font(.callout).foregroundStyle(Brand.muted)
                    Button("Повторить") { retry += 1 }
                }
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
                        if tab == .stickers {
                            ForEach(stickers, id: \.self) { emoji in
                                Button { select(.sticker(emoji)) } label: {
                                    Text(emoji).font(.system(size: 50)).frame(maxWidth: .infinity, minHeight: 84)
                                        .background(Brand.surface, in: RoundedRectangle(cornerRadius: 12))
                                }.buttonStyle(.plain).accessibilityLabel("Отправить стикер \(emoji)")
                            }
                        } else {
                            ForEach(tab == .favorites ? favorites.filter {
                                query.isEmpty || $0.alt.localizedCaseInsensitiveContains(query)
                            } : results) { gif in
                                Button { select(.gif(gif)) } label: {
                                    ChatGifImage(client: client, gif: gif, preview: true)
                                        .frame(maxWidth: .infinity).frame(height: 92)
                                        .background(Brand.surface, in: RoundedRectangle(cornerRadius: 10))
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                }.buttonStyle(.plain).accessibilityLabel("Отправить GIF: \(gif.alt)")
                                .contextMenu {
                                    let saved = favorites.first { $0.id == gif.id }
                                    Button(saved == nil ? "Добавить в избранное" : "Убрать из избранного",
                                           systemImage: saved == nil ? "star" : "star.slash") {
                                        Task {
                                            do {
                                                try await client.setFavoriteGif(saved ?? gif)
                                                favorites = try await client.favoriteGifs()
                                            } catch { failure = error.localizedDescription }
                                        }
                                    }
                                }
                            }
                        }
                    }.padding(.horizontal)
                    if loading || !ready { ProgressView().padding() }
                    if ready && !loading && tab == .search && more && failure == nil {
                        Button("Показать ещё") { page += 1 }.padding()
                    }
                    if ready && !loading && failure == nil {
                        if tab == .favorites && favorites.isEmpty { Text("В избранном пока нет GIF").foregroundStyle(Brand.muted).padding() }
                        if tab == .search && results.isEmpty { Text(key == nil ? "Поиск GIF сейчас недоступен" : "GIF не найдены").foregroundStyle(Brand.muted).padding() }
                    }
                }.scrollDismissesKeyboard(.interactively)
                if tab == .search && key != nil { Text("Powered by KLIPY").font(.caption).foregroundStyle(Brand.muted) }
            }.padding(.vertical, 10).background(Brand.chatCanvas)
                .navigationTitle("GIF и стикеры").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() } } }
                .disabled(sending)
        }
        .task(id: retry) {
            failure = nil
            do {
                key = try await client.gifProviderKey()
                if key == nil && tab == .search { tab = .favorites }
                ready = true
                if tab != .favorites { favorites = (try? await client.favoriteGifs()) ?? [] }
            } catch { if !Task.isCancelled { ready = true; failure = error.localizedDescription } }
        }
        .onChange(of: query) { page = 1 }
        .onChange(of: tab) { page = 1; query = ""; failure = nil }
        .task(id: "\(ready)-\(tab.rawValue)-\(query)-\(page)-\(retry)") {
            guard ready else { return }
            guard tab != .stickers else { loading = false; return }
            loading = true
            failure = nil
            if page == 1 { results = []; more = false }
            defer { if !Task.isCancelled { loading = false } }
            do {
                if tab == .favorites {
                    let value = try await client.favoriteGifs()
                    try Task.checkCancellation()
                    favorites = value
                } else if let key {
                    try await Task.sleep(for: .milliseconds(300))
                    let (items, next) = try await client.searchGifs(key: key, query: query, page: page, language: language)
                    try Task.checkCancellation()
                    var seen = Set(results.map(\.id))
                    results.append(contentsOf: items.filter { seen.insert($0.id).inserted })
                    more = next
                }
            } catch where !Task.isCancelled { failure = error.localizedDescription }
            catch {}
        }
    }

    private func select(_ selection: Selection) {
        guard !sending else { return }
        sending = true
        Task {
            defer { sending = false }
            do { try await send(selection); dismiss() }
            catch { failure = error.localizedDescription }
        }
    }

    @MainActor static func stickerData(_ emoji: String) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: 192, height: 192), format: format).pngData { _ in
            let text = emoji as NSString
            let attributes = [NSAttributedString.Key.font: UIFont.systemFont(ofSize: 144)]
            let size = text.size(withAttributes: attributes)
            text.draw(at: CGPoint(x: (192 - size.width) / 2, y: (192 - size.height) / 2), withAttributes: attributes)
        }
    }
}

struct ChatGifImage: View {
    let client: AccountClient
    let gif: ChatGif
    let preview: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        ZStack {
            if let image { GifImageView(image: image) }
            else if failed { Image(systemName: "photo").foregroundStyle(Brand.muted) }
            else { ProgressView() }
        }.accessibilityLabel(gif.alt)
            .task(id: "\(gif.id)-\(reduceMotion)-\(preview)") {
                failed = false; image = nil
                do {
                    let bytes = try await client.gifImage(gif, preview: preview)
                    let animated = !preview && !reduceMotion
                    let decoded = await Task.detached { Self.decode(bytes, animated: animated) }.value
                    try Task.checkCancellation()
                    image = decoded; failed = decoded == nil
                } catch { if !Task.isCancelled { failed = true } }
            }
    }

    /// Decode a bounded set of thumbnails. A long GIF cannot allocate its original
    /// full-resolution frames in each visible chat cell.
    private nonisolated static func decode(_ data: Data, animated: Bool) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return nil }
        let size = animated ? 240 : 200
        let step = animated ? max(1, Int(ceil(Double(count) / 44))) : count
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: size, kCGImageSourceCreateThumbnailWithTransform: true]
        var frames: [UIImage] = [], duration: Double = 0
        for index in stride(from: 0, to: count, by: step) {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else { continue }
            frames.append(UIImage(cgImage: frame))
            if !animated { break }
            let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = props?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] ?? gif?[kCGImagePropertyGIFDelayTime]) as? Double ?? 0.1
            duration += (delay < 0.02 ? 0.1 : delay) * Double(min(step, count - index))
        }
        return frames.count > 1 ? UIImage.animatedImage(with: frames, duration: duration) : frames.first
    }
}

private struct GifImageView: UIViewRepresentable {
    let image: UIImage
    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = .scaleAspectFit
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }
    func updateUIView(_ view: UIImageView, context: Context) {
        if view.image !== image { view.image = image }
    }
}
#endif
