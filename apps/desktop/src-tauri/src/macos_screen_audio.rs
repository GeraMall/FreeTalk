#[derive(Default)]
pub struct MacosScreenAudioState {
    #[cfg(target_os = "macos")]
    stop_sender: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::MacosScreenAudioState;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use screencapturekit::prelude::*;
    use serde::Serialize;
    use std::sync::mpsc;
    use tauri::{AppHandle, Emitter};

    const SAMPLE_RATE: u32 = 48_000;
    const CHANNELS: u32 = 2;

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AudioPlane {
        channels: u32,
        data: String,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AudioChunk {
        sample_rate: u32,
        channels: u32,
        planes: Vec<AudioPlane>,
    }

    pub fn start(app: AppHandle, state: &MacosScreenAudioState) -> Result<(), String> {
        stop(state)?;
        let (stop_sender, stop_receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);

        std::thread::Builder::new()
            .name("freetalk-screen-audio".into())
            .spawn(move || {
                let result = run_capture(app, stop_receiver, ready_sender.clone());
                if let Err(error) = result {
                    let _ = ready_sender.send(Err(error));
                }
            })
            .map_err(|error| error.to_string())?;

        match ready_receiver.recv().map_err(|error| error.to_string())? {
            Ok(()) => {
                *state
                    .stop_sender
                    .lock()
                    .map_err(|error| error.to_string())? = Some(stop_sender);
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub fn stop(state: &MacosScreenAudioState) -> Result<(), String> {
        if let Some(sender) = state
            .stop_sender
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            let _ = sender.send(());
        }
        Ok(())
    }

    fn run_capture(
        app: AppHandle,
        stop_receiver: mpsc::Receiver<()>,
        ready_sender: mpsc::SyncSender<Result<(), String>>,
    ) -> Result<(), String> {
        let content = SCShareableContent::get().map_err(|error| error.to_string())?;
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or_else(|| "macOS не вернула доступный дисплей".to_string())?;
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();
        let configuration = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(SAMPLE_RATE as i32)
            .with_channel_count(CHANNELS as i32);
        let mut stream = SCStream::new(&filter, &configuration);
        stream.add_output_handler(
            move |sample: CMSampleBuffer, output_type: SCStreamOutputType| {
                if output_type != SCStreamOutputType::Audio || !sample.data_is_ready() {
                    return;
                }
                let Some(buffers) = sample.audio_buffer_list() else {
                    return;
                };
                let planes = buffers
                    .iter()
                    .filter_map(|buffer| {
                        let data = buffer.data();
                        (!data.is_empty()).then(|| AudioPlane {
                            channels: buffer.number_channels,
                            data: STANDARD.encode(data),
                        })
                    })
                    .collect::<Vec<_>>();
                if planes.is_empty() {
                    return;
                }
                let _ = app.emit_to(
                    "main",
                    "macos-screen-audio-chunk",
                    AudioChunk {
                        sample_rate: SAMPLE_RATE,
                        channels: CHANNELS,
                        planes,
                    },
                );
            },
            SCStreamOutputType::Audio,
        );
        stream.start_capture().map_err(|error| error.to_string())?;
        let _ = ready_sender.send(Ok(()));
        let _ = stop_receiver.recv();
        stream.stop_capture().map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
pub fn start(app: tauri::AppHandle, state: &MacosScreenAudioState) -> Result<(), String> {
    platform::start(app, state)
}

#[cfg(not(target_os = "macos"))]
pub fn start(_app: tauri::AppHandle, _state: &MacosScreenAudioState) -> Result<(), String> {
    Err("Нативный захват системного звука доступен только на macOS".into())
}

#[cfg(target_os = "macos")]
pub fn stop(state: &MacosScreenAudioState) -> Result<(), String> {
    platform::stop(state)
}

#[cfg(not(target_os = "macos"))]
pub fn stop(_state: &MacosScreenAudioState) -> Result<(), String> {
    Ok(())
}
