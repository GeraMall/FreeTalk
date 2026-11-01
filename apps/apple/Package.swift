// swift-tools-version: 6.0
import PackageDescription

// Headless checks use the exact same media/signaling sources as the Xcode apps.
let package = Package(
    name: "TRLKAMediaChecks",
    platforms: [.macOS(.v14)],
    dependencies: [.package(url: "https://github.com/stasel/WebRTC.git", exact: "154.0.0")],
    targets: [
        .target(name: "TRLKAMedia", dependencies: [.product(name: "WebRTC", package: "WebRTC")],
                path: "App", exclude: [
                    "AccountStore.swift", "AppShell.swift", "BrandComponents.swift", "CallController.swift",
                    "CallScreen.swift", "ChatListScreen.swift", "ConversationView.swift", "HomeScreen.swift",
                    "LoginView.swift", "SettingsScreen.swift", "TRLKAApp.swift", "PreviewFixtures.swift", "Assets.xcassets", "Resources"
                ], sources: ["MediaPeer.swift", "SocketChannel.swift"]),
        .testTarget(name: "TRLKAMediaTests", dependencies: ["TRLKAMedia", .product(name: "WebRTC", package: "WebRTC")], path: "MediaTests")
    ],
    swiftLanguageModes: [.v5]
)
