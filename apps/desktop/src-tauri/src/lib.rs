mod diagnostics;
mod signaling;
mod secure_session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(signaling::NativeSignalingState::default())
        .invoke_handler(tauri::generate_handler![
            diagnostics::save_connection_diagnostics,
            signaling::signaling_connect,
            signaling::signaling_receive,
            signaling::signaling_send,
            signaling::signaling_close,
            secure_session::secure_session_set,
            secure_session::secure_session_get,
            secure_session::secure_session_clear
        ])
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let mut window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("FreeTalk")
            .inner_size(1454.0, 903.0)
            .min_inner_size(560.0, 520.0)
            .resizable(true)
            .maximizable(true)
            .minimizable(true)
            .closable(true)
            .center();

            #[cfg(target_os = "windows")]
            {
                window = window.decorations(false);
            }

            if let Some(directory) = std::env::var_os("FREETALK_WEBVIEW_DATA_DIR") {
                window = window.data_directory(std::path::PathBuf::from(directory));
            }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FreeTalk");
}
