// Identify this installed app to YouTube as required for desktop embeds.
// This does not disable YouTube verification or change other network requests.
#[cfg(target_os = "windows")]
fn youtube_embed_request(input: &str) -> bool {
    let Ok(url) = url::Url::parse(input) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some("www.youtube.com" | "www.youtube-nocookie.com")
        )
        && url.path().starts_with("/embed/")
}

#[tauri::command]
pub async fn prepare_video_player(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::HashSet;
        use std::sync::{Mutex, OnceLock};
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT;
        use webview2_com::{take_pwstr, WebResourceRequestedEventHandler};
        use windows::core::{w, PWSTR};
        static PREPARED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        let label = webview.label().to_owned();
        if PREPARED
            .get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&label)
        {
            return Ok(());
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |platform| {
                let result = (|| -> windows::core::Result<()> {
                    unsafe {
                        let core = platform.controller().CoreWebView2()?;
                        core.AddWebResourceRequestedFilter(
                            w!("https://www.youtube.com/embed/*"),
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                        )?;
                        core.AddWebResourceRequestedFilter(
                            w!("https://www.youtube-nocookie.com/embed/*"),
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                        )?;
                        let mut token = 0;
                        core.add_WebResourceRequested(
                            &WebResourceRequestedEventHandler::create(Box::new(|_, args| {
                                let Some(args) = args else { return Ok(()) };
                                let request = args.Request()?;
                                let mut uri = PWSTR::null();
                                request.Uri(&mut uri)?;
                                if youtube_embed_request(&take_pwstr(uri)) {
                                    request.Headers()?.SetHeader(
                                        w!("Referer"),
                                        w!("https://io.freetalk.desktop/"),
                                    )?;
                                }
                                Ok(())
                            })),
                            &mut token,
                        )?;
                    }
                    Ok(())
                })()
                .map_err(|error| error.to_string());
                if result.is_ok() {
                    if let Ok(mut labels) = PREPARED.get_or_init(Default::default).lock() {
                        labels.insert(label);
                    }
                }
                let _ = send.send(result);
            })
            .map_err(|error| error.to_string())?;
        return tokio::time::timeout(std::time::Duration::from_secs(3), receive)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = webview;
        Ok(())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::youtube_embed_request;
    #[test]
    fn app_identity_is_only_added_to_youtube_embed_documents() {
        assert!(youtube_embed_request(
            "https://www.youtube-nocookie.com/embed/abcDEF12345?controls=0"
        ));
        assert!(youtube_embed_request(
            "https://www.youtube.com/embed/abcDEF12345"
        ));
        for input in [
            "https://www.youtube.com/watch?v=abcDEF12345",
            "https://www.youtube.com.evil.invalid/embed/test",
            "http://www.youtube.com/embed/test",
            "https://example.com/embed/test",
            "https://user@www.youtube.com/embed/test",
        ] {
            assert!(!youtube_embed_request(input));
        }
    }
}
