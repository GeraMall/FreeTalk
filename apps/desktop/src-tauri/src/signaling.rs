use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

const MAX_SIGNAL_BYTES: usize = 32 * 1024;
const PRODUCTION_SIGNALING_HOST: &str =
    "freetalk-signaling.freetalk-cloudflare-signaling.workers.dev";

#[derive(Default)]
pub struct NativeSignalingState {
    connections: Mutex<HashMap<String, ConnectionControl>>,
    next_generation: AtomicU64,
}

struct ConnectionControl {
    generation: u64,
    commands: mpsc::UnboundedSender<NativeCommand>,
}

enum NativeCommand {
    Send(String),
    Close,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum NativeSignalEvent {
    Open,
    Message { data: String },
    Close { reason: String },
    Error { message: String },
}

fn validate_url(raw: &str) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|_| "Некорректный адрес сигналинга".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "В адресе сигналинга отсутствует хост".to_string())?;
    let production = url.scheme() == "wss" && host == PRODUCTION_SIGNALING_HOST;
    let local = url.scheme() == "ws" && matches!(host, "127.0.0.1" | "localhost" | "::1");
    if !production && !local {
        return Err("Нативный сигналинг разрешён только для сервера FreeTalk".to_string());
    }
    if url.path() != "/ws" {
        return Err("Некорректный путь сигналинга".to_string());
    }
    Ok(())
}

fn validate_message(message: &str) -> Result<(), String> {
    if message.len() > MAX_SIGNAL_BYTES {
        return Err("Сигнальное сообщение превышает 32 КБ".to_string());
    }
    serde_json::from_str::<serde_json::Value>(message)
        .map(|_| ())
        .map_err(|_| "Сигнальное сообщение не является JSON".to_string())
}

#[tauri::command]
pub async fn signaling_connect(
    app: AppHandle,
    state: State<'_, NativeSignalingState>,
    connection_id: String,
    url: String,
    on_event: Channel<NativeSignalEvent>,
) -> Result<(), String> {
    validate_url(&url)?;
    if connection_id.len() > 64 || connection_id.is_empty() {
        return Err("Некорректный идентификатор соединения".to_string());
    }

    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    let (commands, receiver) = mpsc::unbounded_channel();
    if let Some(previous) = state.connections.lock().await.insert(
        connection_id.clone(),
        ConnectionControl {
            generation,
            commands,
        },
    ) {
        let _ = previous.commands.send(NativeCommand::Close);
    }

    tauri::async_runtime::spawn(run_connection(
        app,
        connection_id,
        generation,
        url,
        receiver,
        on_event,
    ));
    Ok(())
}

#[tauri::command]
pub async fn signaling_send(
    state: State<'_, NativeSignalingState>,
    connection_id: String,
    message: String,
) -> Result<(), String> {
    validate_message(&message)?;
    let connections = state.connections.lock().await;
    let connection = connections
        .get(&connection_id)
        .ok_or_else(|| "Нативный сигналинг не подключён".to_string())?;
    connection
        .commands
        .send(NativeCommand::Send(message))
        .map_err(|_| "Нативный сигналинг уже закрыт".to_string())
}

#[tauri::command]
pub async fn signaling_close(
    state: State<'_, NativeSignalingState>,
    connection_id: String,
) -> Result<(), String> {
    if let Some(connection) = state.connections.lock().await.remove(&connection_id) {
        let _ = connection.commands.send(NativeCommand::Close);
    }
    Ok(())
}

async fn run_connection(
    app: AppHandle,
    connection_id: String,
    generation: u64,
    url: String,
    mut commands: mpsc::UnboundedReceiver<NativeCommand>,
    on_event: Channel<NativeSignalEvent>,
) {
    match connect_async(&url).await {
        Ok((socket, _response)) => {
            let _ = on_event.send(NativeSignalEvent::Open);
            let (mut writer, mut reader) = socket.split();
            loop {
                tokio::select! {
                    command = commands.recv() => match command {
                        Some(NativeCommand::Send(value)) => {
                            if writer.send(Message::Text(value.into())).await.is_err() {
                                let _ = on_event.send(NativeSignalEvent::Error {
                                    message: "Не удалось отправить сообщение через нативный сигналинг".into(),
                                });
                                break;
                            }
                        }
                        Some(NativeCommand::Close) | None => {
                            let _ = writer.close().await;
                            break;
                        }
                    },
                    incoming = reader.next() => match incoming {
                        Some(Ok(Message::Text(value))) if value.len() <= MAX_SIGNAL_BYTES => {
                            let _ = on_event.send(NativeSignalEvent::Message { data: value.to_string() });
                        }
                        Some(Ok(Message::Close(frame))) => {
                            let reason = frame.map(|item| item.reason.to_string()).unwrap_or_default();
                            let _ = on_event.send(NativeSignalEvent::Close { reason });
                            break;
                        }
                        Some(Ok(Message::Ping(value))) => {
                            if writer.send(Message::Pong(value)).await.is_err() { break; }
                        }
                        Some(Ok(_)) => {}
                        Some(Err(error)) => {
                            let _ = on_event.send(NativeSignalEvent::Error { message: error.to_string() });
                            break;
                        }
                        None => break,
                    }
                }
            }
        }
        Err(error) => {
            let _ = on_event.send(NativeSignalEvent::Error {
                message: format!("Нативное WSS-соединение не установлено: {error}"),
            });
        }
    }

    let state = app.state::<NativeSignalingState>();
    let mut connections = state.connections.lock().await;
    if connections
        .get(&connection_id)
        .is_some_and(|connection| connection.generation == generation)
    {
        connections.remove(&connection_id);
        let _ = on_event.send(NativeSignalEvent::Close {
            reason: "Соединение закрыто".into(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_message, validate_url};

    #[test]
    fn only_allows_freetalk_or_local_signaling() {
        assert!(validate_url(
            "wss://freetalk-signaling.freetalk-cloudflare-signaling.workers.dev/ws?room=ABCDEFGH2345"
        )
        .is_ok());
        assert!(validate_url("ws://127.0.0.1:8787/ws?room=ABCDEFGH2345").is_ok());
        assert!(validate_url("wss://example.com/ws").is_err());
        assert!(validate_url(
            "https://freetalk-signaling.freetalk-cloudflare-signaling.workers.dev/ws"
        )
        .is_err());
    }

    #[test]
    fn limits_and_validates_outbound_messages() {
        assert!(validate_message(r#"{"type":"ping","timestamp":1}"#).is_ok());
        assert!(validate_message("not json").is_err());
        assert!(validate_message(&format!(r#"{{"value":"{}"}}"#, "x".repeat(33_000))).is_err());
    }
}
