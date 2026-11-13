#if os(iOS)
import SwiftUI
import ImageIO
import UniformTypeIdentifiers
import TRLKACore

struct ChatAttachment: Sendable {
    let bytes: Data
    let name: String
    let isImage: Bool
    var thumbnail: Data?

    static func file(_ url: URL) throws -> Self {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let attributes = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard attributes.isRegularFile == true, let size = attributes.fileSize, size > 0, size <= 30 * 1024 * 1024 else {
            throw APIError(status: 0, code: "INVALID_FILE", message: "Выберите непустой файл размером до 30 МБ.")
        }
        return try Self(bytes: Data(contentsOf: url, options: .mappedIfSafe), name: url.lastPathComponent, isImage: false)
    }

    static func photo(_ input: Data) throws -> Self {
        guard let source = CGImageSourceCreateWithData(input as CFData, nil) else { throw URLError(.cannotDecodeContentData) }
        func jpeg(_ size: Int, quality: Double) throws -> Data {
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: size]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
            let output = NSMutableData()
            guard let encoder = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw URLError(.cannotCreateFile) }
            CGImageDestinationAddImage(encoder, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            guard CGImageDestinationFinalize(encoder) else { throw URLError(.cannotCreateFile) }
            return output as Data
        }
        var full = try jpeg(2048, quality: 0.83)
        if full.count > 3 * 1024 * 1024 { full = try jpeg(1280, quality: 0.75) }
        return try Self(bytes: full, name: "photo.jpg", isImage: true, thumbnail: jpeg(384, quality: 0.7))
    }
}

struct ChatAttachmentView: View {
    let message: Message
    let client: AccountClient
    @State private var preview: UIImage?
    @State private var document: Download?
    @State private var saving = false
    @State private var exporting = false
    @State private var failure: String?
    @State private var showingPhoto = false
    @State private var fullImage: UIImage?
    @State private var exportType: UTType = .data
    private var filename: String {
        if message.kind == "image" { return "photo." + (exportType.preferredFilenameExtension ?? "jpg") }
        return ((message.metadata?.filename ?? "file") as NSString).lastPathComponent
    }

    private struct Download: FileDocument {
        static let readableContentTypes: [UTType] = [.data]
        let bytes: Data
        init(_ bytes: Data) { self.bytes = bytes }
        init(configuration: ReadConfiguration) throws {
            guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
            bytes = data
        }
        func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                guard !saving else { return }
                saving = true
                Task {
                    defer { saving = false }
                    do {
                        let bytes = try await client.attachment(messageID: message.id, image: message.kind == "image")
                        document = Download(bytes)
                        failure = nil
                        if message.kind == "image" {
                            guard let decoded = UIImage(data: bytes) else { throw URLError(.cannotDecodeContentData) }
                            fullImage = decoded
                            if let source = CGImageSourceCreateWithData(bytes as CFData, nil),
                               let type = CGImageSourceGetType(source) { exportType = UTType(type as String) ?? .data }
                            showingPhoto = true
                        } else {
                            exportType = UTType(filenameExtension: (filename as NSString).pathExtension) ?? .data
                            exporting = true
                        }
                    } catch { failure = error.localizedDescription }
                }
            } label: {
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFit().frame(maxWidth: 240, maxHeight: 180)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    Label(message.metadata?.filename ?? "Фотография", systemImage: saving ? "hourglass" : "arrow.down.doc")
                        .font(.callout).lineLimit(2).padding(10).webPanel(10)
                }
            }.buttonStyle(.plain).disabled(saving).accessibilityHint("Сохранить вложение")
            if let failure { Text(failure).font(.caption).foregroundStyle(.red) }
        }
        .task(id: message.id) {
            guard message.kind == "image" else { return }
            if let bytes = try? await client.attachment(messageID: message.id, image: true, thumbnail: true), !Task.isCancelled {
                preview = UIImage(data: bytes)
            }
        }
        .sheet(isPresented: $showingPhoto, onDismiss: {
            fullImage = nil
            if !saving { document = nil }
        }) {
            NavigationStack {
                Group {
                    if let fullImage { Image(uiImage: fullImage).resizable().scaledToFit() }
                }.navigationTitle("Фотография").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { showingPhoto = false } }
                    ToolbarItem(placement: .primaryAction) { Button("Сохранить") { exporting = true } }
                }
                .fileExporter(isPresented: $exporting, document: document, contentType: exportType, defaultFilename: filename) { result in
                    if case .failure(let error) = result { failure = error.localizedDescription }
                }
            }
        }
        .fileExporter(isPresented: Binding(get: { exporting && !showingPhoto }, set: { exporting = $0 }),
                      document: document, contentType: exportType, defaultFilename: filename) { result in
            document = nil
            if case .failure(let error) = result, (error as NSError).code != NSUserCancelledError { failure = error.localizedDescription }
        }
    }
}
#endif
