//! Native screen media. Only SDP, ICE and lifecycle events cross Tauri IPC.
//! Pixels and PCM remain in the native capture/WebRTC pipeline.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: String,
    title: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    source_id: String,
    kind: String,
    fps: u32,
    width: u32,
    height: u32,
    bitrate: u64,
    audio: bool,
}

#[derive(Deserialize)]
pub struct IceServer {
    urls: Vec<String>,
    username: Option<String>,
    credential: Option<String>,
}

#[cfg(not(target_os = "windows"))]
#[derive(Default)]
pub struct State;

#[cfg(target_os = "windows")]
pub use native::State;

#[tauri::command]
pub async fn windows_screen_sources() -> Result<Vec<Source>, String> {
    #[cfg(target_os = "windows")]
    {
        return tauri::async_runtime::spawn_blocking(native::sources)
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    Err("Native Windows capture is unavailable".into())
}

#[tauri::command]
pub async fn windows_screen_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    options: CaptureOptions,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return native::start(app, &state, options).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, options);
        Err("Native Windows capture is unavailable".into())
    }
}

#[tauri::command]
pub async fn windows_screen_stop(
    state: tauri::State<'_, State>,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        native::stop(&state, &session_id);
    }
    let _ = (state, session_id);
    Ok(())
}

#[tauri::command]
pub async fn windows_screen_offer(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    session_id: String,
    peer_id: String,
    ice_servers: Vec<IceServer>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return native::offer(app, &state, &session_id, &peer_id, ice_servers).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, session_id, peer_id, ice_servers);
        Err("Unsupported platform".into())
    }
}

#[tauri::command]
pub async fn windows_screen_answer(
    state: tauri::State<'_, State>,
    session_id: String,
    peer_id: String,
    sdp: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return native::answer(&state, &session_id, &peer_id, &sdp).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, session_id, peer_id, sdp);
        Err("Unsupported platform".into())
    }
}

#[tauri::command]
pub async fn windows_screen_ice(
    state: tauri::State<'_, State>,
    session_id: String,
    peer_id: String,
    candidate: String,
    mid: String,
    mline: i32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return native::ice(&state, &session_id, &peer_id, &candidate, &mid, mline).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, session_id, peer_id, candidate, mid, mline);
        Err("Unsupported platform".into())
    }
}

#[tauri::command]
pub fn windows_screen_close_peer(
    state: tauri::State<'_, State>,
    session_id: String,
    peer_id: String,
) {
    #[cfg(target_os = "windows")]
    if let Ok(session) = native::session(&state, &session_id) {
        if let Some(pc) = session.peers.lock().unwrap().remove(&peer_id) {
            pc.close();
        }
    }
    let _ = (state, session_id, peer_id);
}

#[tauri::command]
pub async fn windows_screen_restart_peer(
    state: tauri::State<'_, State>,
    session_id: String,
    peer_id: String,
    ice_servers: Vec<IceServer>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return native::restart_peer(&state, &session_id, &peer_id, ice_servers).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, session_id, peer_id, ice_servers);
        Err("Unsupported platform".into())
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::*;
    use libwebrtc::{
        audio_frame::AudioFrame,
        audio_source::{native::NativeAudioSource, AudioSourceOptions},
        desktop_capturer::{
            CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions,
        },
        ice_candidate::IceCandidate,
        peer_connection::{OfferOptions, PeerConnection},
        peer_connection_factory::{
            native::PeerConnectionFactoryExt, PeerConnectionFactory, RtcConfiguration,
        },
        session_description::{SdpType, SessionDescription},
        video_frame::{I420Buffer, VideoFrame, VideoRotation},
        video_source::{native::NativeVideoSource, VideoResolution},
    };
    use std::{
        collections::{HashMap, VecDeque},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    use tauri::Emitter;

    #[derive(Default)]
    pub struct State {
        current: Mutex<Option<Arc<Session>>>,
        starting: AtomicBool,
        factory: std::sync::OnceLock<PeerConnectionFactory>,
    }
    pub struct Session {
        id: String,
        stop: Arc<AtomicBool>,
        factory: PeerConnectionFactory,
        video: NativeVideoSource,
        audio: Option<NativeAudioSource>,
        pub peers: Mutex<HashMap<String, PeerConnection>>,
        bitrate: u64,
        fps: u32,
    }
    impl Drop for Session {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            for (_, pc) in self.peers.get_mut().unwrap().drain() {
                pc.close();
            }
        }
    }
    fn error(e: impl std::fmt::Display) -> String {
        e.to_string()
    }
    fn deliver_frame(
        video: &NativeVideoSource,
        frame: &libwebrtc::desktop_capturer::DesktopFrame,
        timestamp_us: i64,
    ) {
        if frame.width() <= 0 || frame.height() <= 0 {
            return;
        }
        let mut buffer = I420Buffer::new(frame.width() as u32, frame.height() as u32);
        let (sy, su, sv) = buffer.strides();
        let (y, u, v) = buffer.data_mut();
        libwebrtc::native::yuv_helper::argb_to_i420(
            frame.data(),
            frame.stride(),
            y,
            sy,
            u,
            su,
            v,
            sv,
            frame.width(),
            frame.height(),
        );
        let target = video.video_resolution();
        let scale = (target.width as f64 / frame.width() as f64)
            .min(target.height as f64 / frame.height() as f64)
            .min(1.0);
        if scale < 1.0 {
            let width = ((frame.width() as f64 * scale) as i32 / 2 * 2).max(2);
            let height = ((frame.height() as f64 * scale) as i32 / 2 * 2).max(2);
            buffer = buffer.scale(width, height);
        }
        video.capture_frame(&VideoFrame {
            rotation: VideoRotation::VideoRotation0,
            timestamp_us,
            frame_metadata: None,
            buffer,
        });
    }
    fn capturer(kind: &str) -> Result<DesktopCapturer, String> {
        let source_type = match kind {
            "screen" => DesktopCaptureSourceType::Screen,
            "window" => DesktopCaptureSourceType::Window,
            _ => return Err("Invalid source type".into()),
        };
        let mut options = DesktopCapturerOptions::new(source_type);
        options.set_include_cursor(true);
        DesktopCapturer::new(options)
            .ok_or_else(|| "Windows не смогла запустить захват экрана".into())
    }
    pub fn sources() -> Result<Vec<Source>, String> {
        let mut result = Vec::new();
        for kind in ["screen", "window"] {
            let capture = capturer(kind)?;
            for item in capture.get_source_list() {
                result.push(Source {
                    id: item.id().to_string(),
                    title: item.title(),
                    kind: kind.into(),
                });
            }
        }
        Ok(result)
    }
    pub fn session(state: &State, id: &str) -> Result<Arc<Session>, String> {
        state
            .current
            .lock()
            .unwrap()
            .as_ref()
            .filter(|s| s.id == id && !s.stop.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| "Screen session is no longer active".into())
    }
    pub fn stop(state: &State, id: &str) {
        let mut current = state.current.lock().unwrap();
        if current.as_ref().is_some_and(|s| s.id == id) {
            if let Some(s) = current.take() {
                s.stop.store(true, Ordering::Release);
                for (_, pc) in s.peers.lock().unwrap().drain() {
                    pc.close();
                }
            }
        }
    }
    pub async fn start(
        app: tauri::AppHandle,
        state: &State,
        options: CaptureOptions,
    ) -> Result<String, String> {
        if ![15, 30, 60].contains(&options.fps)
            || !(320..=2560).contains(&options.width)
            || !(180..=1440).contains(&options.height)
            || options.bitrate > 20_000_000
        {
            return Err("Invalid capture settings".into());
        }
        if state.starting.swap(true, Ordering::AcqRel) {
            return Err("Демонстрация уже запускается".into());
        }
        struct StartingGuard<'a>(&'a AtomicBool);
        impl Drop for StartingGuard<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _starting_guard = StartingGuard(&state.starting);
        if state.current.lock().unwrap().is_some() {
            return Err("Демонстрация уже запущена".into());
        }
        let id = format!(
            "screen-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(error)?
                .as_nanos()
        );
        let video = NativeVideoSource::new(
            VideoResolution {
                width: options.width,
                height: options.height,
            },
            true,
        );
        let audio = options.audio.then(|| {
            NativeAudioSource::new(
                AudioSourceOptions {
                    echo_cancellation: false,
                    noise_suppression: false,
                    auto_gain_control: false,
                },
                48_000,
                2,
                50,
            )
        });
        let stop = Arc::new(AtomicBool::new(false));
        let session = Arc::new(Session {
            id: id.clone(),
            stop: stop.clone(),
            factory: state
                .factory
                .get_or_init(PeerConnectionFactory::default)
                .clone(),
            video: video.clone(),
            audio: audio.clone(),
            peers: Mutex::new(HashMap::new()),
            bitrate: options.bitrate,
            fps: options.fps,
        });
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let capture_stop = stop.clone();
        let event_app = app.clone();
        let event_id = id.clone();
        let capture_kind = options.kind.clone();
        let capture_id = options.source_id.clone();
        std::thread::Builder::new().name("trlka-screen-capture".into()).spawn(move || {
            let setup=(|| {
                let mut capture=capturer(&capture_kind)?;
                let source=capture.get_source_list().into_iter().find(|s| s.id().to_string()==capture_id).ok_or("Выбранное окно или экран уже закрыты")?;
                let failed=Arc::new(AtomicBool::new(false));
                let first_frame=Arc::new(AtomicBool::new(false));
                let callback_first_frame=first_frame.clone();
                let callback_failed=failed.clone();
                let start=Instant::now();
                capture.start_capture(Some(source),move |frame| {
                    match frame {
                        Ok(frame) if frame.width()>0 && frame.height()>0 => {
                            deliver_frame(&video,&frame,start.elapsed().as_micros() as i64);
                            callback_first_frame.store(true,Ordering::Release);
                        },
                        Err(CaptureError::Permanent) => { callback_failed.store(true,Ordering::Release); },
                        _ => {},
                    }
                });
                Ok::<_,String>((capture,failed,first_frame))
            })();
            match setup {
                Ok((mut capture,failed,first_frame)) => {
                    let starting=Instant::now();
                    while !first_frame.load(Ordering::Acquire) && !failed.load(Ordering::Acquire) && !capture_stop.load(Ordering::Acquire) && starting.elapsed()<Duration::from_secs(5) {
                        capture.capture_frame();
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    if !first_frame.load(Ordering::Acquire) || failed.load(Ordering::Acquire) {
                        let _=ready_tx.send(Err("Windows не вернула изображение выбранного окна или экрана".into()));
                        return;
                    }
                    let _=ready_tx.send(Ok(()));
                    while !capture_stop.load(Ordering::Acquire) && !failed.load(Ordering::Acquire) {
                        let began=Instant::now();
                        capture.capture_frame();
                        std::thread::sleep(Duration::from_millis(1000/options.fps as u64).saturating_sub(began.elapsed()));
                    }
                    if failed.load(Ordering::Acquire) {
                        capture_stop.store(true,Ordering::Release);
                        let _=event_app.emit("windows-screen-ended",serde_json::json!({"sessionId":event_id,"reason":"Окно закрыто или захват экрана прерван Windows"}));
                    }
                },
                Err(e) => { let _=ready_tx.send(Err(e)); },
            }
        }).map_err(error)?;
        let ready = tokio::time::timeout(Duration::from_secs(8), ready_rx).await;
        match ready {
            Ok(Ok(Ok(()))) => {}
            other => {
                stop.store(true, Ordering::Release);
                return Err(format!("Не удалось запустить нативный захват: {other:?}"));
            }
        }
        if let Some(audio) = audio {
            let audio_stop = stop.clone();
            let audio_app = app.clone();
            let audio_id = id.clone();
            let runtime = tokio::runtime::Handle::current();
            let window_pid = if options.kind == "window" {
                let mut pid = 0;
                if let Ok(hwnd) = options.source_id.parse::<usize>() {
                    unsafe {
                        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                            windows::Win32::Foundation::HWND(hwnd as *mut _),
                            Some(&mut pid),
                        );
                    }
                }
                Some(pid)
            } else {
                None
            };
            std::thread::Builder::new()
                .name("trlka-screen-audio".into())
                .spawn(move || {
                    let mut failures = 0;
                    while !audio_stop.load(Ordering::Acquire) {
                        if let Err(e) = audio_loop(&audio, &audio_stop, window_pid, &runtime) {
                            failures += 1;
                            if failures >= 3 {
                                let _ = audio_app.emit(
                                    "windows-screen-audio-error",
                                    serde_json::json!({"sessionId":audio_id,"reason":e}),
                                );
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(300));
                        }
                    }
                })
                .map_err(error)?;
        }
        *state.current.lock().unwrap() = Some(session);
        Ok(id)
    }
    fn audio_loop(
        source: &NativeAudioSource,
        stop: &AtomicBool,
        window_pid: Option<u32>,
        runtime: &tokio::runtime::Handle,
    ) -> Result<(), String> {
        use wasapi::*;
        initialize_mta().ok().map_err(error)?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                wasapi::deinitialize();
            }
        }
        let _apartment = Apartment;
        // For a window include its process tree; for a monitor exclude Trlka to
        // prevent sending the other participants' voices back to them.
        let mut client = AudioClient::new_application_loopback_client(
            window_pid.unwrap_or(std::process::id()),
            window_pid.is_some(),
        )
        .map_err(error)?;
        let format = WaveFormat::new(16, 16, &SampleType::Int, 48_000, 2, None);
        client
            .initialize_client(
                &format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: 200_000,
                },
            )
            .map_err(error)?;
        let event = client.set_get_eventhandle().map_err(error)?;
        let capture = client.get_audiocaptureclient().map_err(error)?;
        let mut queue = VecDeque::new();
        client.start_stream().map_err(error)?;
        let result = (|| {
            while !stop.load(Ordering::Acquire) {
                let _ = event.wait_for_event(50);
                capture
                    .read_from_device_to_deque(&mut queue)
                    .map_err(error)?;
                while queue.len() >= 1920 {
                    let bytes: Vec<u8> = queue.drain(..1920).collect();
                    let data: Vec<i16> = bytes
                        .chunks_exact(2)
                        .map(|b| i16::from_le_bytes([b[0], b[1]]))
                        .collect();
                    runtime
                        .block_on(source.capture_frame(&AudioFrame {
                            data: data.into(),
                            sample_rate: 48_000,
                            num_channels: 2,
                            samples_per_channel: 480,
                        }))
                        .map_err(error)?;
                }
            }
            Ok(())
        })();
        let _ = client.stop_stream();
        result
    }
    pub async fn offer(
        app: tauri::AppHandle,
        state: &State,
        id: &str,
        peer_id: &str,
        servers: Vec<IceServer>,
    ) -> Result<String, String> {
        if peer_id.len() > 160 || servers.len() > 16 {
            return Err("Invalid peer".into());
        }
        let session = session(state, id)?;
        {
            let peers = session.peers.lock().unwrap();
            if peers.len() >= 9 && !peers.contains_key(peer_id) {
                return Err("Screen participant limit reached".into());
            }
        }
        let mut config = RtcConfiguration::default();
        config.ice_servers = servers
            .into_iter()
            .map(|s| libwebrtc::peer_connection_factory::IceServer {
                urls: s.urls,
                username: s.username.unwrap_or_default(),
                password: s.credential.unwrap_or_default(),
            })
            .collect();
        let pc = session
            .factory
            .create_peer_connection(config)
            .map_err(error)?;
        let sid = id.to_string();
        let pid = peer_id.to_string();
        pc.on_ice_candidate(Some(Box::new(move |candidate| {
            let _=app.emit("windows-screen-ice",serde_json::json!({"sessionId":sid,"peerId":pid,"candidate":candidate.candidate(),"mid":candidate.sdp_mid(),"mline":candidate.sdp_mline_index()}));
        })));
        let track = session
            .factory
            .create_video_track("trlka-native-screen", session.video.clone());
        let sender = pc
            .add_track(track.into(), &["trlka-native-screen"])
            .map_err(error)?;
        sender.set_video_encoder_backend(libwebrtc::rtp_sender::VideoEncoderBackend::Hardware);
        let mut codecs = session
            .factory
            .get_rtp_sender_capabilities(libwebrtc::MediaType::Video)
            .codecs;
        codecs.sort_by_key(|codec| {
            if codec.mime_type.eq_ignore_ascii_case("video/H264") {
                0
            } else {
                1
            }
        });
        for transceiver in pc.transceivers() {
            if matches!(
                transceiver.sender().track(),
                Some(libwebrtc::media_stream_track::MediaStreamTrack::Video(_))
            ) {
                transceiver
                    .set_codec_preferences(codecs.clone())
                    .map_err(error)?;
            }
        }
        let mut parameters = sender.parameters();
        for encoding in &mut parameters.encodings {
            encoding.max_bitrate = Some(session.bitrate);
            encoding.max_framerate = Some(session.fps as f64);
        }
        sender.set_parameters(parameters).map_err(error)?;
        if let Some(source) = &session.audio {
            let track = session
                .factory
                .create_audio_track("trlka-native-screen-audio", source.clone());
            pc.add_track(track.into(), &["trlka-native-screen"])
                .map_err(error)?;
        }
        if let Some(old) = session
            .peers
            .lock()
            .unwrap()
            .insert(peer_id.to_string(), pc.clone())
        {
            old.close();
        }
        let offer = pc
            .create_offer(OfferOptions::default())
            .await
            .map_err(error)?;
        let sdp = offer.to_string();
        pc.set_local_description(offer).await.map_err(error)?;
        Ok(sdp)
    }
    fn peer(state: &State, id: &str, pid: &str) -> Result<PeerConnection, String> {
        session(state, id)?
            .peers
            .lock()
            .unwrap()
            .get(pid)
            .cloned()
            .ok_or_else(|| "Screen peer closed".into())
    }
    pub async fn answer(state: &State, id: &str, pid: &str, sdp: &str) -> Result<(), String> {
        let pc = peer(state, id, pid)?;
        pc.set_remote_description(SessionDescription::parse(sdp, SdpType::Answer).map_err(error)?)
            .await
            .map_err(error)?;
        let session = session(state, id)?;
        for sender in pc.senders() {
            if matches!(
                sender.track(),
                Some(libwebrtc::media_stream_track::MediaStreamTrack::Video(_))
            ) {
                let mut params = sender.parameters();
                for encoding in &mut params.encodings {
                    encoding.max_bitrate = Some(session.bitrate);
                    encoding.max_framerate = Some(session.fps as f64);
                }
                sender.set_parameters(params).map_err(error)?;
            }
        }
        Ok(())
    }
    pub async fn restart_peer(
        state: &State,
        id: &str,
        pid: &str,
        servers: Vec<IceServer>,
    ) -> Result<String, String> {
        let pc = peer(state, id, pid)?;
        if servers.len() > 16 {
            return Err("Invalid ICE configuration".into());
        }
        let mut config = RtcConfiguration::default();
        config.ice_servers = servers
            .into_iter()
            .map(|s| libwebrtc::peer_connection_factory::IceServer {
                urls: s.urls,
                username: s.username.unwrap_or_default(),
                password: s.credential.unwrap_or_default(),
            })
            .collect();
        pc.set_configuration(config).map_err(error)?;
        pc.restart_ice();
        let offer = pc
            .create_offer(OfferOptions {
                ice_restart: true,
                ..Default::default()
            })
            .await
            .map_err(error)?;
        let sdp = offer.to_string();
        pc.set_local_description(offer).await.map_err(error)?;
        Ok(sdp)
    }
    pub async fn ice(
        state: &State,
        id: &str,
        pid: &str,
        candidate: &str,
        mid: &str,
        mline: i32,
    ) -> Result<(), String> {
        peer(state, id, pid)?
            .add_ice_candidate(IceCandidate::parse(mid, mline, candidate).map_err(error)?)
            .await
            .map_err(error)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use futures_util::StreamExt;
        use libwebrtc::{
            media_stream_track::MediaStreamTrack, peer_connection::AnswerOptions,
            video_stream::native::NativeVideoStream,
        };

        #[test]
        fn malformed_screen_sdp_returns_error_without_aborting() {
            assert!(SessionDescription::parse("invalid SDP", SdpType::Answer).is_err());
        }

        #[tokio::test]
        #[ignore = "Uses the local Windows audio endpoint and plays a quiet test tone"]
        async fn native_system_audio_restarts() {
            let factory = PeerConnectionFactory::default();
            for attempt in 0..5 {
                let source = NativeAudioSource::new(
                    AudioSourceOptions {
                        echo_cancellation: false,
                        noise_suppression: false,
                        auto_gain_control: false,
                    },
                    48_000,
                    2,
                    50,
                );
                let track = factory.create_audio_track("native-audio-smoke", source.clone());
                let mut received =
                    libwebrtc::audio_stream::native::NativeAudioStream::new(track, 48_000, 2);
                let stop = Arc::new(AtomicBool::new(false));
                let capture_stop = stop.clone();
                let runtime = tokio::runtime::Handle::current();
                let capture = std::thread::spawn(move || {
                    audio_loop(&source, &capture_stop, Some(std::process::id()), &runtime)
                });
                let render_stop = stop.clone();
                let render = std::thread::spawn(move || -> Result<(), String> {
                    use wasapi::*;
                    initialize_mta().ok().map_err(error)?;
                    let device = DeviceEnumerator::new()
                        .map_err(error)?
                        .get_default_device(&Direction::Render)
                        .map_err(error)?;
                    let mut client = device.get_iaudioclient().map_err(error)?;
                    let format = WaveFormat::new(16, 16, &SampleType::Int, 48_000, 2, None);
                    client
                        .initialize_client(
                            &format,
                            &Direction::Render,
                            &StreamMode::EventsShared {
                                autoconvert: true,
                                buffer_duration_hns: 200_000,
                            },
                        )
                        .map_err(error)?;
                    let event = client.set_get_eventhandle().map_err(error)?;
                    let renderer = client.get_audiorenderclient().map_err(error)?;
                    client.start_stream().map_err(error)?;
                    let mut position = 0u64;
                    while !render_stop.load(Ordering::Acquire) {
                        let count = client.get_available_space_in_frames().map_err(error)? as usize;
                        let mut bytes = VecDeque::with_capacity(count * 4);
                        for _ in 0..count {
                            let sample =
                                ((position as f64 * 440.0 * std::f64::consts::TAU / 48_000.0).sin()
                                    * 300.0) as i16;
                            bytes.extend(sample.to_le_bytes());
                            bytes.extend(sample.to_le_bytes());
                            position += 1;
                        }
                        if count > 0 {
                            renderer
                                .write_to_device_from_deque(count, &mut bytes, None)
                                .map_err(error)?;
                        }
                        let _ = event.wait_for_event(50);
                    }
                    client.stop_stream().map_err(error)?;
                    deinitialize();
                    Ok(())
                });
                let detected = tokio::time::timeout(Duration::from_secs(8), async {
                    while let Some(frame) = received.next().await {
                        if frame.data.iter().any(|sample| sample.abs() > 20) {
                            return true;
                        }
                    }
                    false
                })
                .await;
                stop.store(true, Ordering::Release);
                capture.join().unwrap().expect("WASAPI capture");
                render.join().unwrap().expect("WASAPI render");
                received.close();
                assert!(
                    detected.unwrap_or(false),
                    "No native PCM audio after restart {attempt}"
                );
                eprintln!("Audio restart {attempt}: non-silent stereo PCM captured");
            }
        }

        #[tokio::test]
        #[ignore = "Captures the local interactive Windows desktop; run explicitly"]
        async fn native_screen_round_trip_restarts() {
            let available = sources().expect("enumerate native sources");
            let selected = available
                .iter()
                .find(|source| source.kind == "screen")
                .expect("an interactive monitor is required");
            eprintln!(
                "Native sources: {} screens, {} windows",
                available.iter().filter(|s| s.kind == "screen").count(),
                available.iter().filter(|s| s.kind == "window").count()
            );
            eprintln!(
                "Encoder backends: {:?}",
                libwebrtc::rtp_sender::VideoEncoderBackend::list_available()
                    .into_iter()
                    .collect::<Vec<_>>()
            );
            let factory = PeerConnectionFactory::default();
            for attempt in 0..5 {
                let source = NativeVideoSource::new(
                    VideoResolution {
                        width: 1280,
                        height: 720,
                    },
                    true,
                );
                let outgoing = factory
                    .create_peer_connection(RtcConfiguration::default())
                    .unwrap();
                let incoming = factory
                    .create_peer_connection(RtcConfiguration::default())
                    .unwrap();
                let (ice_tx, mut ice_rx) = tokio::sync::mpsc::unbounded_channel();
                let out_tx = ice_tx.clone();
                outgoing.on_ice_candidate(Some(Box::new(move |candidate| {
                    let _ = out_tx.send((
                        true,
                        candidate.sdp_mid(),
                        candidate.sdp_mline_index(),
                        candidate.candidate(),
                    ));
                })));
                incoming.on_ice_candidate(Some(Box::new(move |candidate| {
                    let _ = ice_tx.send((
                        false,
                        candidate.sdp_mid(),
                        candidate.sdp_mline_index(),
                        candidate.candidate(),
                    ));
                })));
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                incoming.on_track(Some(Box::new(move |event| {
                    if let MediaStreamTrack::Video(track) = event.track {
                        let _ = tx.send(NativeVideoStream::new(track));
                    }
                })));
                let track = factory.create_video_track("native-smoke", source.clone());
                let sender = outgoing.add_track(track.into(), &["native-smoke"]).unwrap();
                sender.set_video_encoder_backend(
                    libwebrtc::rtp_sender::VideoEncoderBackend::Hardware,
                );
                let offer = outgoing
                    .create_offer(OfferOptions::default())
                    .await
                    .unwrap();
                outgoing.set_local_description(offer.clone()).await.unwrap();
                incoming.set_remote_description(offer).await.unwrap();
                let answer = incoming
                    .create_answer(AnswerOptions::default())
                    .await
                    .unwrap();
                incoming
                    .set_local_description(answer.clone())
                    .await
                    .unwrap();
                outgoing.set_remote_description(answer).await.unwrap();
                let ice_out = outgoing.clone();
                let ice_in = incoming.clone();
                let ice_task = tokio::spawn(async move {
                    while let Some((to_in, mid, index, sdp)) = ice_rx.recv().await {
                        let pc = if to_in { &ice_in } else { &ice_out };
                        pc.add_ice_candidate(IceCandidate::parse(&mid, index, &sdp).unwrap())
                            .await
                            .unwrap();
                    }
                });
                let mut decoded = tokio::time::timeout(Duration::from_secs(5), rx.recv())
                    .await
                    .unwrap()
                    .unwrap();
                let stop = Arc::new(AtomicBool::new(false));
                let captured = Arc::new(std::sync::atomic::AtomicUsize::new(0));
                let capture_count = captured.clone();
                let capture_stop = stop.clone();
                let id = selected.id.clone();
                let worker = std::thread::spawn(move || {
                    let mut capture = capturer("screen").unwrap();
                    let selected = capture
                        .get_source_list()
                        .into_iter()
                        .find(|s| s.id().to_string() == id)
                        .unwrap();
                    let start = Instant::now();
                    capture.start_capture(Some(selected), move |frame| {
                        if let Ok(frame) = frame {
                            capture_count.fetch_add(1, Ordering::Relaxed);
                            deliver_frame(&source, &frame, start.elapsed().as_micros() as i64);
                        }
                    });
                    while !capture_stop.load(Ordering::Acquire) {
                        capture.capture_frame();
                        std::thread::sleep(Duration::from_millis(33));
                    }
                });
                let received = tokio::time::timeout(Duration::from_secs(15), async {
                    let mut count = 0;
                    while count < 5 {
                        let frame = decoded.next().await.expect("video stream closed");
                        assert!(frame.buffer.width() > 0);
                        count += 1;
                    }
                    count
                })
                .await;
                stop.store(true, Ordering::Release);
                worker.join().unwrap();
                outgoing.close();
                incoming.close();
                decoded.close();
                ice_task.abort();
                assert!(
                    captured.load(Ordering::Relaxed) > 0,
                    "WGC returned no actual desktop frames"
                );
                eprintln!(
                    "Restart {attempt}: decoded {} native frames",
                    received.expect("native screen produced no decoded video")
                );
            }
        }
    }
}
