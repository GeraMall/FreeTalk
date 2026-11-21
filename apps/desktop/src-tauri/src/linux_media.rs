use gtk::prelude::*;
use webkit2gtk::{
    PermissionRequestExt, PolicyDecisionExt, PolicyDecisionType, ResponsePolicyDecision,
    ResponsePolicyDecisionExt, SettingsExt, URIRequestExt, UserMediaPermissionRequest,
    UserMediaPermissionRequestExt, WebView, WebViewExt,
};

fn trusted_origin(uri: &str) -> bool {
    let Ok(url) = url::Url::parse(uri) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none())
        || (cfg!(dev)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420))
}

pub(super) fn configure(view: &WebView) {
    if let Some(settings) = WebViewExt::settings(view) {
        settings.set_enable_webrtc(true);
        settings.set_enable_media_stream(true);
    }

    // Only guard top-level documents so video embeds can keep loading in subframes.
    view.connect_decide_policy(|_, decision, kind| {
        if kind != PolicyDecisionType::Response {
            return false;
        }
        let Some(response) = decision.downcast_ref::<ResponsePolicyDecision>() else {
            return false;
        };
        if response.is_main_frame_main_resource()
            && !response
                .request()
                .and_then(|request| request.uri())
                .is_some_and(|uri| trusted_origin(&uri))
        {
            decision.ignore();
            return true;
        }
        false
    });

    view.connect_permission_request(|view, request| {
        let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
            return false;
        };
        if !view.uri().is_some_and(|uri| trusted_origin(&uri)) {
            request.deny();
            return true;
        }

        let message = match (media.is_for_audio_device(), media.is_for_video_device()) {
            (true, true) => "Разрешить Trlka доступ к микрофону и камере?",
            (true, false) => "Разрешить Trlka доступ к микрофону?",
            (false, true) => "Разрешить Trlka доступ к камере?",
            (false, false) => {
                // The ScreenCast portal still asks the user to choose a source.
                request.allow();
                return true;
            }
        };

        let Some(parent) = view
            .toplevel()
            .and_then(|widget| widget.downcast::<gtk::Window>().ok())
        else {
            request.deny();
            return true;
        };
        let dialog = gtk::MessageDialog::new(
            Some(&parent),
            gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
            gtk::MessageType::Question,
            gtk::ButtonsType::YesNo,
            message,
        );
        dialog.set_title("Trlka");
        dialog.set_default_response(gtk::ResponseType::No);
        let request = request.clone();
        let view = view.downgrade();
        let responded = std::cell::Cell::new(false);
        dialog.connect_response(move |dialog, response| {
            if responded.replace(true) {
                return;
            }
            if response == gtk::ResponseType::Yes
                && view
                    .upgrade()
                    .and_then(|view| view.uri())
                    .is_some_and(|uri| trusted_origin(&uri))
            {
                request.allow();
            } else {
                request.deny();
            }
            if response != gtk::ResponseType::DeleteEvent {
                dialog.close();
            }
        });
        dialog.present();
        true
    });
}

#[cfg(test)]
mod tests {
    use super::trusted_origin;

    #[test]
    fn recognizes_only_the_bundled_app_and_development_origin() {
        assert!(trusted_origin("tauri://localhost/index.html"));
        assert_eq!(trusted_origin("http://127.0.0.1:1420/"), cfg!(dev));
        for remote in [
            "tauri://localhost.example.com/index.html",
            "tauri://someone@localhost/",
            "tauri://localhost:1420/",
            "https://localhost/",
            "http://127.0.0.1:8080/",
            "https://www.youtube-nocookie.com/embed/video",
        ] {
            assert!(!trusted_origin(remote));
        }
    }
}
