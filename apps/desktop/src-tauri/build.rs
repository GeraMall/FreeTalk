fn main() {
    tauri_build::build();

    // ScreenCaptureKit links Swift's concurrency runtime as an @rpath library.
    // Tauri only emits a Frameworks rpath when explicit frameworks are bundled,
    // so add both the macOS system Swift location and the conventional app
    // Frameworks location to prevent a pre-launch DYLD crash in packaged apps.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
