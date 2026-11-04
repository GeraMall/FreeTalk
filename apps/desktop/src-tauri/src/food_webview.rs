use serde::Deserialize;
use std::sync::OnceLock;
use tauri::{Manager, Webview};
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
struct Vendor {
    id: String,
    url: String,
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    hosts: Vec<String>,
}

fn vendors() -> &'static [Vendor] {
    static VENDORS: OnceLock<Vec<Vendor>> = OnceLock::new();
    VENDORS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/lib/food-vendors.json"))
            .expect("invalid bundled delivery catalog")
    })
}

fn find_vendor(id: &str) -> Result<&'static Vendor, String> {
    vendors()
        .iter()
        .find(|vendor| vendor.id == id)
        .ok_or_else(|| "Unknown delivery service".to_owned())
}

#[tauri::command]
pub fn food_vendor_open_browser(webview: Webview, vendor: String) -> Result<(), String> {
    if !matches!(webview.label(), "main" | "call-placeholder-window") {
        return Err("Delivery service is unavailable in this window".to_owned());
    }

    webview
        .app_handle()
        .opener()
        .open_url(&find_vendor(&vendor)?.url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
pub struct FoodBounds {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn food_vendor_view(
    webview: Webview,
    vendor: Option<String>,
    bounds: Option<FoodBounds>,
    close: bool,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Embedded delivery is unavailable in this window".to_owned());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let vendor = vendor.as_deref().map(find_vendor).transpose()?;
        update_view(webview, vendor.zip(bounds), close).map_err(|error| error.to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (vendor, bounds, close);
        Err("Embedded delivery is only available on Windows and macOS".to_owned())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn vendor_label(vendor: &Vendor) -> String {
    format!("food-vendor-{}", vendor.id)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn allows_navigation(vendor: &Vendor, url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| vendor.hosts.iter().any(|allowed| allowed == host))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn update_view(
    webview: Webview,
    target: Option<(&'static Vendor, FoodBounds)>,
    close: bool,
) -> tauri::Result<()> {
    use tauri::webview::{NewWindowResponse, PermissionResponse, WebviewBuilder};
    use tauri::{LogicalPosition, LogicalSize, Rect, WebviewUrl};

    let app = webview.app_handle();
    let selected_label = target.as_ref().map(|(vendor, _)| vendor_label(vendor));
    for vendor in vendors() {
        let label = vendor_label(vendor);
        if let Some(view) = app.get_webview(&label) {
            if close {
                view.close()?;
            } else if selected_label.as_deref() != Some(label.as_str()) {
                view.hide()?;
            }
        }
    }
    let Some((vendor, bounds)) = target.filter(|_| !close) else {
        return Ok(());
    };

    let label = vendor_label(vendor);
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width, bounds.height);
    if let Some(view) = app.get_webview(&label) {
        view.set_bounds(Rect {
            position: position.into(),
            size: size.into(),
        })?;
        return view.show();
    }

    let url = vendor.url.parse().expect("invalid bundled delivery URL");
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .incognito(true)
        .devtools(false)
        .disable_drag_drop_handler()
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_navigation(move |url| allows_navigation(vendor, url));

    #[cfg(target_os = "windows")]
    let builder = builder.data_directory(app.path().app_local_data_dir()?.join("food-webview"));

    webview.window().add_child(builder, position, size)?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FoodBrowserAction {
    Back,
    Reload,
}

#[tauri::command]
pub async fn food_vendor_browser_action(
    webview: Webview,
    vendor: String,
    action: FoodBrowserAction,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Embedded delivery is unavailable in this window".to_owned());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let vendor = find_vendor(&vendor)?;
        let Some(view) = webview.app_handle().get_webview(&vendor_label(vendor)) else {
            return Ok(());
        };
        let result = match action {
            FoodBrowserAction::Reload => view.reload(),
            #[cfg(target_os = "macos")]
            FoodBrowserAction::Back => {
                if view.url().is_ok_and(|url| allows_navigation(vendor, &url)) {
                    view.eval("history.back()")
                } else {
                    Ok(())
                }
            }
            #[cfg(target_os = "windows")]
            FoodBrowserAction::Back => view.with_webview(|platform| unsafe {
                if let Ok(core) = platform.controller().CoreWebView2() {
                    let _ = core.GoBack();
                }
            }),
        };
        result.map_err(|error| error.to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (vendor, action);
        Err("Embedded delivery is only available on Windows and macOS".to_owned())
    }
}
