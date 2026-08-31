mod diagnostics;
mod macos_screen_audio;
mod secure_session;
mod signaling;

#[cfg(desktop)]
#[derive(Default)]
struct CallPopoutTransitionState(std::sync::atomic::AtomicBool);

#[cfg(desktop)]
fn log_call_popout(app: &tauri::AppHandle, event: &str) {
    use std::io::Write;
    use tauri::Manager;

    let Ok(directory) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&directory);
    let path = directory.join("call-popout.log");
    if path.metadata().map(|metadata| metadata.len() > 256 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{{\"timestampMs\":{timestamp},\"event\":{event:?}}}");
    }
}

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

#[tauri::command]
fn open_recordings_directory(path: String) -> Result<(), String> {
    let directory = std::path::PathBuf::from(path);
    if !directory.is_dir() {
        return Err("recordings directory does not exist".to_string());
    }
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recording_storage_available(path: String) -> Result<u64, String> {
    let mut directory = std::path::PathBuf::from(path);
    while !directory.exists() {
        if !directory.pop() {
            return Err("recordings volume is unavailable".to_string());
        }
    }
    fs2::available_space(directory).map_err(|error| error.to_string())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("call-placeholder-window") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
    }
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
fn fit_webview_to_window(webview: &tauri::Webview, window: &tauri::Window) -> Result<(), String> {
    let size = window.inner_size().map_err(|error| error.to_string())?;
    webview
        .set_bounds(tauri::Rect {
            position: tauri::Position::Physical(tauri::PhysicalPosition::new(0, 0)),
            size: tauri::Size::Physical(size),
        })
        .map_err(|error| error.to_string())?;
    // Existing WebViews can be reparented on Windows, but WebView2 may reject
    // changing auto-resize after the native controller has moved. Native resize
    // events below keep the reparented view in sync instead.
    Ok(())
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

#[cfg(desktop)]
#[tauri::command]
fn main_window_start_dragging(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::{
            Foundation::{LPARAM, WPARAM},
            UI::{
                Input::KeyboardAndMouse::ReleaseCapture,
                WindowsAndMessaging::PostMessageW,
            },
        };

        // Always move the caller's native HWND. While a call is detached the
        // visible shell is `call-placeholder-window`, not the hidden `main`
        // window, so resolving a hard-coded label moves the wrong window.
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let _ = ReleaseCapture();
            // WM_NCLBUTTONDOWN = 0x00A1, HTCAPTION = 2.
            let _ = PostMessageW(Some(hwnd), 0x00A1, WPARAM(2), LPARAM(0));
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        window.start_dragging().map_err(|error| error.to_string())
    }
}

#[cfg(desktop)]
fn restore_call_popout(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let main_window = app
        .get_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let main_webview = app
        .get_webview("main")
        .ok_or_else(|| "main webview is unavailable".to_string())?;

    if let Some(placeholder) = app.get_webview_window("call-placeholder-window") {
        let _ = placeholder.emit("call-placeholder-hidden", ());
        let _ = placeholder.hide();
    }

    main_webview
        .reparent(&main_window)
        .map_err(|error| error.to_string())?;
    fit_webview_to_window(&main_webview, &main_window)?;
    if let Some(popout) = app.get_window("call-popout") {
        let _ = popout.hide();
    }
    let _ = main_webview.emit("call-popout-restored", ());
    let _ = main_window.show();
    let _ = main_window.set_focus();
    Ok(())
}

#[cfg(desktop)]
fn open_call_popout(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{webview::Color, Emitter, Manager, WindowBuilder};

    let main_window = app
        .get_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let main_webview = app
        .get_webview("main")
        .ok_or_else(|| "main webview is unavailable".to_string())?;
    let placeholder = app
        .get_webview_window("call-placeholder-window")
        .ok_or_else(|| "call placeholder window is unavailable".to_string())?;
    let main_position = main_window
        .outer_position()
        .map_err(|error| error.to_string())?;
    let main_size = main_window
        .inner_size()
        .map_err(|error| error.to_string())?;
    let main_maximized = main_window.is_maximized().unwrap_or(false);
    let _ = placeholder.unmaximize();
    placeholder
        .set_position(tauri::PhysicalPosition::new(main_position.x, main_position.y))
        .map_err(|error| error.to_string())?;
    placeholder
        .set_size(tauri::PhysicalSize::new(main_size.width, main_size.height))
        .map_err(|error| error.to_string())?;
    if main_maximized {
        placeholder.maximize().map_err(|error| error.to_string())?;
    }
    let popout = if let Some(window) = app.get_window("call-popout") {
        window
    } else {
        WindowBuilder::new(app, "call-popout")
            .title("FreeTalk — звонок")
            .inner_size(1180.0, 760.0)
            .min_inner_size(640.0, 480.0)
            .resizable(true)
            .maximizable(true)
            .minimizable(true)
            .closable(true)
            .center()
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?
    };
    let background = Color(2, 8, 18, 255);
    let _ = main_window.set_background_color(Some(background));
    let _ = popout.set_background_color(Some(background));
    let _ = placeholder.set_background_color(Some(background));

    if let Err(error) = main_webview.reparent(&popout) {
        let _ = placeholder.hide();
        let _ = popout.hide();
        return Err(error.to_string());
    }
    if let Err(error) = fit_webview_to_window(&main_webview, &popout) {
        let _ = restore_call_popout(&app);
        return Err(error);
    }

    if let Err(error) = main_window.hide() {
        let _ = restore_call_popout(&app);
        return Err(error.to_string());
    }
    if let Err(error) = placeholder.show() {
        let _ = restore_call_popout(&app);
        return Err(error.to_string());
    }
    let _ = placeholder.emit("call-placeholder-shown", ());
    if let Err(error) = popout.show() {
        let _ = restore_call_popout(&app);
        return Err(error.to_string());
    }
    let _ = popout.set_focus();
    Ok(())
}

#[cfg(desktop)]
fn schedule_call_popout_transition(
    app: tauri::AppHandle,
    name: &'static str,
    transition: fn(&tauri::AppHandle) -> Result<(), String>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};

    let state = app.state::<CallPopoutTransitionState>();
    if state
        .0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        log_call_popout(&app, &format!("{name}:ignored-already-running"));
        return Ok(());
    }

    log_call_popout(&app, &format!("{name}:scheduled"));
    std::thread::spawn(move || {
        // The command response must leave the originating WebView before that
        // same WebView is detached or reparented, otherwise WebView2 can deadlock.
        std::thread::sleep(std::time::Duration::from_millis(40));
        let transition_app = app.clone();
        let schedule_result = app.run_on_main_thread(move || {
            log_call_popout(&transition_app, &format!("{name}:started"));
            match transition(&transition_app) {
                Ok(()) => log_call_popout(&transition_app, &format!("{name}:completed")),
                Err(error) => {
                    log_call_popout(&transition_app, &format!("{name}:failed:{error}"));
                    let _ = transition_app.emit("call-popout-error", error);
                }
            }
            transition_app
                .state::<CallPopoutTransitionState>()
                .0
                .store(false, Ordering::Release);
        });
        if let Err(error) = schedule_result {
            log_call_popout(&app, &format!("{name}:schedule-failed:{error}"));
            app.state::<CallPopoutTransitionState>()
                .0
                .store(false, Ordering::Release);
            let _ = app.emit("call-popout-error", error.to_string());
        }
    });
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn call_popout_open(app: tauri::AppHandle) -> Result<(), String> {
    schedule_call_popout_transition(app, "open", open_call_popout)
}

#[cfg(desktop)]
#[tauri::command]
fn call_popout_restore(app: tauri::AppHandle) -> Result<(), String> {
    schedule_call_popout_transition(app, "restore", restore_call_popout)
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
        .manage(CallPopoutTransitionState::default())
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
            open_recordings_directory,
            recording_storage_available,
            notification_overlay_show,
            notification_overlay_hide,
            notification_overlay_open_main,
            main_window_start_dragging,
            call_popout_open,
            call_popout_restore
        ])
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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

            let mut placeholder_window = tauri::WebviewWindowBuilder::new(
                app,
                "call-placeholder-window",
                tauri::WebviewUrl::App("index.html?call-placeholder=1".into()),
            )
            .title("FreeTalk")
            .inner_size(1454.0, 903.0)
            .min_inner_size(560.0, 520.0)
            .resizable(true)
            .maximizable(true)
            .minimizable(true)
            .closable(true)
            .visible(false);
            #[cfg(target_os = "windows")]
            {
                placeholder_window = placeholder_window.decorations(false);
            }
            let _placeholder_window = placeholder_window.build()?;

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
            if let tauri::WindowEvent::Resized(size) = event {
                use tauri::Manager;

                let app = window.app_handle();
                let webview = match window.label() {
                    "call-popout" => app.get_webview("main"),
                    _ => None,
                };
                if let Some(webview) = webview {
                    let _ = webview.set_bounds(tauri::Rect {
                        position: tauri::Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                        size: tauri::Size::Physical(*size),
                    });
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                use tauri_plugin_window_state::AppHandleExt;

                if matches!(window.label(), "call-popout" | "call-placeholder-window") {
                    api.prevent_close();
                    let _ = schedule_call_popout_transition(
                        window.app_handle().clone(),
                        "restore-close-requested",
                        restore_call_popout,
                    );
                    return;
                }

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
