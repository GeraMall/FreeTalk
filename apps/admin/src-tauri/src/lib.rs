use std::sync::Mutex;
use tauri::Manager;

#[derive(Default)]
struct AdminSession(Mutex<Option<String>>);

#[tauri::command]
fn admin_session_set(state: tauri::State<'_, AdminSession>, refresh_token: String) -> Result<(), String> {
    if !(32..=256).contains(&refresh_token.len()) { return Err("invalid refresh token".into()); }
    *state.0.lock().map_err(|_| "session lock failed")? = Some(refresh_token);
    Ok(())
}

#[tauri::command]
fn admin_session_get(state: tauri::State<'_, AdminSession>) -> Result<Option<String>, String> {
    Ok(state.0.lock().map_err(|_| "session lock failed")?.clone())
}

#[tauri::command]
fn admin_session_clear(state: tauri::State<'_, AdminSession>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "session lock failed")? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdminSession::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![admin_session_set, admin_session_get, admin_session_clear])
        .run(tauri::generate_context!())
        .expect("error while running FreeTalk Admin");
}
