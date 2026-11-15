import Foundation

public struct ChatGif: Codable, Equatable, Sendable, Identifiable {
    public struct Credit: Codable, Equatable, Sendable {
        public let provider: String
        public let title: String
        public let pageUrl: String
        public var author: String?
        public var license: String?
    }
    public var assetId: String?
    public var favoriteId: String?
    public var providerId: String?
    public let url: String
    public var previewUrl: String?
    public var width: Int?
    public var height: Int?
    public let alt: String
    public let attribution: Credit
    public var id: String { assetId ?? url }

    static func trusted(_ value: String, host: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", url.host == host,
              url.user == nil, url.password == nil, url.port == nil else { return nil }
        return url
    }
    func remoteImage(preview: Bool) -> URL? {
        let host: String
        switch attribution.provider {
        case "KLIPY": host = "static.klipy.com"
        case "Wikimedia Commons": host = "upload.wikimedia.org"
        default: return nil
        }
        return Self.trusted(preview ? previewUrl ?? url : url, host: host)
    }
}

struct GifProviderConfig: Decodable { let provider: String?; let apiKey: String? }
struct KlipyFeed: Decodable {
    let result: Bool
    let data: Page
    struct Page: Decodable { let data: [Item]; let has_next: Bool? }
    struct Item: Decodable {
        let id: Identifier
        let title: String?
        let slug: String?
        let file: [String: Rendition]?
        struct Rendition: Decodable { let gif: Image? }
        struct Image: Decodable { let url: String; let width: Int?; let height: Int?; let size: Int? }
        struct Identifier: Decodable {
            let value: String
            init(from decoder: Decoder) throws {
                let field = try decoder.singleValueContainer()
                if let value = try? field.decode(String.self) { self.value = value }
                else { self.value = String(try field.decode(Int.self)) }
            }
        }
        func gif() -> ChatGif? {
            func rendition(_ sizes: [String], limit: Int) -> Image? {
                sizes.lazy.compactMap { file?[$0]?.gif }.first {
                    ChatGif.trusted($0.url, host: "static.klipy.com")?.pathExtension.lowercased() == "gif"
                        && ($0.size ?? 0) <= limit
                }
            }
            guard !id.value.isEmpty, id.value.count <= 128,
                  let image = rendition(["md", "sm", "xs", "hd"], limit: 30 * 1024 * 1024) else { return nil }
            let name = String((title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
            let label = name.isEmpty ? "GIF" : name
            let page = URL(string: "https://klipy.com/gifs/")!.appendingPathComponent(slug ?? id.value)
            func dimension(_ value: Int?) -> Int? { value.flatMap { (1...4096).contains($0) ? $0 : nil } }
            return ChatGif(providerId: id.value, url: image.url,
                           previewUrl: rendition(["xs", "sm", "md"], limit: 512 * 1024)?.url,
                           width: dimension(image.width), height: dimension(image.height), alt: label,
                           attribution: .init(provider: "KLIPY", title: label, pageUrl: page.absoluteString))
        }
    }
}

/// The provider key may only be requested from TRLKA. Neither search nor media
/// requests to the provider carry TRLKA credentials, cookies or cross-host redirects.
final class GifProviderSession: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = GifProviderSession()
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 18
        return URLSession(configuration: config, delegate: shared, delegateQueue: nil)
    }()
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let sameOrigin = request.url?.scheme == "https" && request.url?.host == task.originalRequest?.url?.host &&
            request.url?.port == nil && request.url?.user == nil && request.url?.password == nil
        completionHandler(sameOrigin ? request : nil)
    }
    func download(_ url: URL, limit: Int) async throws -> Data {
        let (temporary, response) = try await Self.session.download(from: url)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.expectedContentLength <= limit,
              let size = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0, size <= limit else { throw URLError(.badServerResponse) }
        return try Data(contentsOf: temporary, options: .mappedIfSafe)
    }
}
