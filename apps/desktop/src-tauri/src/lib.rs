mod diagnostics;
mod macos_screen_audio;
mod secure_session;
mod signaling;

#[tauri::command]
fn macos_screen_audio_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, macos_screen_audio::MacosScreenAudioState>,
) -> Result<(), String> {
    macos_screen_audio::start(app, &state)
}

#[tauri::command]
fn macos_screen_audio_stop(
    state: tauri::State<'_, macos_screen_audio::MacosScreenAudioState>,
) -> Result<(), String> {
    macos_screen_audio::stop(&state)
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn persisted_window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

#[cfg(desktop)]
#[tauri::command]
fn notification_overlay_show(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition};

    let overlay = app
        .get_webview_window("notifications")
        .ok_or_else(|| "notification window is unavailable".to_string())?;
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let size = overlay.outer_size().map_err(|error| error.to_string())?;
        let x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - 16;
        let y = work_area.position.y + work_area.size.height as i32 - size.height as i32 - 16;
        overlay
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
    }

    overlay.show().map_err(|error| error.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn notification_overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let overlay = app
        .get_webview_window("notifications")
        .ok_or_else(|| "notification window is unavailable".to_string())?;
    overlay.hide().map_err(|error| error.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn notification_overlay_open_main(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(overlay) = app.get_webview_window("notifications") {
        let _ = overlay.hide();
    }
    show_main_window(&app);
    Ok(())
}

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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(persisted_window_state_flags())
                .build(),
        )
        .manage(signaling::NativeSignalingState::default())
        .manage(macos_screen_audio::MacosScreenAudioState::default())
        .invoke_handler(tauri::generate_handler![
            diagnostics::save_connection_diagnostics,
            signaling::signaling_connect,
            signaling::signaling_receive,
            signaling::signaling_send,
            signaling::signaling_close,
            secure_session::secure_session_set,
            secure_session::secure_session_get,
            secure_session::secure_session_clear,
            macos_screen_audio_start,
            macos_screen_audio_stop,
            notification_overlay_show,
            notification_overlay_hide,
            notification_overlay_open_main
        ])
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;

            let first_launch_marker = app
                .path()
                .app_config_dir()?
                .join("window-state-initialized");
            let first_launch = !first_launch_marker.exists();
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
            .maximized(first_launch)
            .center();

            #[cfg(target_os = "windows")]
            {
                window = window.decorations(false);
            }

            if let Some(directory) = std::env::var_os("FREETALK_WEBVIEW_DATA_DIR") {
                window = window.data_directory(std::path::PathBuf::from(directory));
            }
            let main_window = window.build()?;

            let _notification_window = tauri::WebviewWindowBuilder::new(
                app,
                "notifications",
                tauri::WebviewUrl::App("index.html?notification-overlay=1".into()),
            )
            .title("FreeTalk notifications")
            .inner_size(390.0, 380.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .shadow(false)
            .visible(false)
            .build()?;

            if first_launch {
                if let Some(parent) = first_launch_marker.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&first_launch_marker, b"1");
                let _ = main_window.maximize();
            }

            #[cfg(desktop)]
            {
                use tauri::{
                    menu::{Menu, MenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                };

                let open = MenuItem::with_id(app, "open", "Открыть FreeTalk", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Выйти полностью", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &quit])?;
                let mut tray = TrayIconBuilder::with_id("freetalk-tray")
                    .tooltip("FreeTalk — работает в фоне")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                use tauri_plugin_window_state::AppHandleExt;

                let _ = window
                    .app_handle()
                    .save_window_state(persisted_window_state_flags());
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run FreeTalk");
}
