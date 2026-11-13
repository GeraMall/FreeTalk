// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TRLKACore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "TRLKACore", targets: ["TRLKACore"])],
    targets: [
        .target(name: "TRLKACore"),
        .testTarget(name: "TRLKACoreTests", dependencies: ["TRLKACore"])
    ],
    swiftLanguageModes: [.v5]
)
