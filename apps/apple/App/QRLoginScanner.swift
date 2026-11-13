#if os(iOS)
import AVFoundation
import SwiftUI
import VisionKit
import TRLKACore

struct QRLoginScanner: View {
    let account: AccountStore
    @Environment(\.dismiss) private var dismiss
    @State private var cameraReady = false
    @State private var challenge: String?
    @State private var error: String?
    @State private var approving = false
    @State private var approved = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                if approved {
                    Label("Вход на компьютере подтверждён.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Brand.online)
                } else if let challenge {
                    Text("Сверьте код на своём компьютере и подтвердите вход.")
                    Text(String(challenge.prefix(5)).uppercased())
                        .font(.title2.monospaced().bold())
                    if let error {
                        Text(error).foregroundStyle(.red)
                    }
                    Button("Подтвердить вход") { Task { await approve(challenge) } }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.accent)
                        .disabled(approving || error != nil)
                    if error != nil {
                        Button("Сканировать снова") {
                            error = nil
                            self.challenge = nil
                        }
                    }
                } else if let error {
                    Text(error).foregroundStyle(Brand.muted)
                } else if cameraReady {
                    Text("Наведите камеру на QR-код на экране компьютера.")
                    QRLoginCamera(onScan: { challenge = $0 }, onFailure: {
                        error = "Не удалось запустить камеру."
                    })
                    .frame(maxWidth: 420)
                    .frame(height: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                } else {
                    ProgressView()
                }
            }
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Brand.webBackground)
            .navigationTitle("Сканировать QR для входа")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem { Button("Закрыть") { dismiss() } } }
        }
        .task {
            guard DataScannerViewController.isSupported else {
                error = "Сканер QR недоступен на этом устройстве."
                return
            }
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                error = "Разрешите доступ к камере в настройках iPhone."
                return
            }
            cameraReady = true
        }
    }

    private func approve(_ challenge: String) async {
        approving = true
        defer { approving = false }
        do {
            try await account.client.approveQRLogin(challenge: challenge)
            approved = true
        } catch {
            self.error = "Не удалось подтвердить вход. Откройте новый QR-код на компьютере."
        }
    }
}

private struct QRLoginCamera: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan, onFailure: onFailure)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        Task { @MainActor [weak scanner] in
            do { try scanner?.startScanning() }
            catch { context.coordinator.onFailure() }
        }
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        let onFailure: () -> Void

        init(onScan: @escaping (String) -> Void, onFailure: @escaping () -> Void) {
            self.onScan = onScan
            self.onFailure = onFailure
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            let prefix = "trlka:qr-login:v1:"
            for item in addedItems {
                guard case .barcode(let barcode) = item,
                      let value = barcode.payloadStringValue,
                      value.hasPrefix(prefix) else { continue }
                let token = String(value.dropFirst(prefix.count))
                guard token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { continue }
                scanner.stopScanning()
                onScan(token)
                return
            }
        }

        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            onFailure()
        }
    }
}
#endif

