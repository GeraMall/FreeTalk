const COMMANDS: &[&str] = &["set", "get", "clear"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build the FreeTalk secure-session plugin");
}
