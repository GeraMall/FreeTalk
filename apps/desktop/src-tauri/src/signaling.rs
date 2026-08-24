use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
    sync::Arc,
};
use tauri::{AppHandle, Manager, State};
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
    events: Arc<Mutex<mpsc::UnboundedReceiver<NativeSignalEvent>>>,
}

enum NativeCommand {
    Send(String),
    Close,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum NativeSignalEvent {
    Open {
        #[serde(rename = "serverConnectionId")]
        server_connection_id: Option<String>,
        #[serde(rename = "edgeColo")]
        edge_colo: Option<String>,
        #[serde(rename = "cfRay")]
        cf_ray: Option<String>,
    },
    Message {
        data: String,
    },
    Sent {
        #[serde(rename = "messageType")]
        message_type: String,
        timestamp: u64,
    },
    Close {
        code: u16,
        reason: String,
        #[serde(rename = "initiatedBy")]
        initiated_by: String,
    },
    Error {
        message: String,
    },
}

fn ping_timestamp(message: &str) -> Option<u64> {
    let value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    (value.get("type")?.as_str()? == "ping")
        .then(|| value.get("timestamp")?.as_u64())
        .flatten()
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

fn debug_message(direction: &str, message: &str) {
    if std::env::var_os("FREETALK_SIGNAL_DEBUG").is_none() {
        return;
    }
    let kind = serde_json::from_str::<serde_json::Value>(message)
        .ok()
        .and_then(|value| value.get("type")?.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".into());
    eprintln!("FreeTalk signaling {direction}: {kind}");
}

#[tauri::command]
pub async fn signaling_connect(
    app: AppHandle,
    state: State<'_, NativeSignalingState>,
    connection_id: String,
    url: String,
) -> Result<(), String> {
    validate_url(&url)?;
    if connection_id.is_empty()
        || connection_id.len() > 64
        || !connection_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Некорректный идентификатор соединения".to_string());
    }

    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    let (commands, receiver) = mpsc::unbounded_channel();
    let (events, event_receiver) = mpsc::unbounded_channel();
    if let Some(previous) = state.connections.lock().await.insert(
        connection_id.clone(),
        ConnectionControl {
            generation,
            commands,
            events: Arc::new(Mutex::new(event_receiver)),
        },
    ) {
        let _ = previous.commands.send(NativeCommand::Close);
    }

    // The socket task owns network I/O. Incoming events are retained in a
    // per-connection queue until the frontend explicitly receives them, so
    // late room/SDP/ICE messages cannot be lost between IPC event callbacks.
    tauri::async_runtime::spawn(run_connection(
        app,
        connection_id,
        generation,
        url,
        receiver,
        events,
    ));
    Ok(())
}

#[tauri::command]
pub async fn signaling_receive(
    state: State<'_, NativeSignalingState>,
    connection_id: String,
) -> Result<NativeSignalEvent, String> {
    let events = {
        let connections = state.connections.lock().await;
        connections
            .get(&connection_id)
            .map(|connection| Arc::clone(&connection.events))
            .ok_or_else(|| "Нативный сигналинг не подключён".to_string())?
    };

    let event = events
        .lock()
        .await
        .recv()
        .await
        .ok_or_else(|| "Нативный сигналинг уже закрыт".to_string())?;
    Ok(event)
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
    events: mpsc::UnboundedSender<NativeSignalEvent>,
) {
    match connect_async(&url).await {
        Ok((socket, response)) => {
            let header = |name: &str| {
                response
                    .headers()
                    .get(name)
                    .and_then(|value| value.to_str().ok())
                    .map(ToOwned::to_owned)
            };
            let _ = events.send(NativeSignalEvent::Open {
                server_connection_id: header("x-freetalk-server-connection-id"),
                edge_colo: header("x-freetalk-edge-colo"),
                cf_ray: header("cf-ray"),
            });
            let (mut writer, mut reader) = socket.split();
            loop {
                tokio::select! {
                    command = commands.recv() => match command {
                        Some(NativeCommand::Send(value)) => {
                            debug_message("out", &value);
                            let ping_timestamp = ping_timestamp(&value);
                            if writer.send(Message::Text(value.into())).await.is_err() {
                                let _ = events.send(NativeSignalEvent::Error {
                                    message: "Не удалось отправить сообщение через нативный сигналинг".into(),
                                });
                                break;
                            }
                            if let Some(timestamp) = ping_timestamp {
                                let _ = events.send(NativeSignalEvent::Sent {
                                    message_type: "ping".into(),
                                    timestamp,
                                });
                            }
                        }
                        Some(NativeCommand::Close) | None => {
                            let _ = writer.close().await;
                            break;
                        }
                    },
                    incoming = reader.next() => match incoming {
                        Some(Ok(Message::Text(value))) if value.len() <= MAX_SIGNAL_BYTES => {
                            debug_message("in", &value);
                            let _ = events.send(NativeSignalEvent::Message { data: value.to_string() });
                        }
                        Some(Ok(Message::Close(frame))) => {
                            let (code, reason) = frame
                                .map(|item| (u16::from(item.code), item.reason.to_string()))
                                .unwrap_or((1005, String::new()));
                            let _ = events.send(NativeSignalEvent::Close {
                                code,
                                reason,
                                initiated_by: "server".into(),
                            });
                            break;
                        }
                        Some(Ok(Message::Ping(value))) => {
                            if writer.send(Message::Pong(value)).await.is_err() { break; }
                        }
                        Some(Ok(_)) => {}
                        Some(Err(error)) => {
                            let _ = events.send(NativeSignalEvent::Error { message: error.to_string() });
                            break;
                        }
                        None => {
                            let _ = events.send(NativeSignalEvent::Close {
                                code: 1006,
                                reason: "Поток WebSocket завершился без close frame".into(),
                                initiated_by: "transport".into(),
                            });
                            break;
                        },
                    }
                }
            }
        }
        Err(error) => {
            let _ = events.send(NativeSignalEvent::Error {
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
        let _ = events.send(NativeSignalEvent::Close {
            code: 1006,
            reason: "Задача нативного WebSocket завершена".into(),
            initiated_by: "transport".into(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{ping_timestamp, validate_message, validate_url, NativeSignalEvent};

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

    #[test]
    fn extracts_only_ping_timestamps_for_native_send_confirmation() {
        assert_eq!(
            ping_timestamp(r#"{"type":"ping","timestamp":1787565956}"#),
            Some(1787565956)
        );
        assert_eq!(ping_timestamp(r#"{"type":"leave-room"}"#), None);
        assert_eq!(ping_timestamp("not-json"), None);
    }

    #[test]
    fn serializes_native_diagnostic_fields_for_typescript() {
        let opened = serde_json::to_value(NativeSignalEvent::Open {
            server_connection_id: Some("server-connection".into()),
            edge_colo: Some("SVO".into()),
            cf_ray: Some("ray-SVO".into()),
        })
        .unwrap();
        assert_eq!(opened["serverConnectionId"], "server-connection");
        assert_eq!(opened["edgeColo"], "SVO");
        assert_eq!(opened["cfRay"], "ray-SVO");

        let sent = serde_json::to_value(NativeSignalEvent::Sent {
            message_type: "ping".into(),
            timestamp: 123,
        })
        .unwrap();
        assert_eq!(sent["kind"], "sent");
        assert_eq!(sent["messageType"], "ping");
        assert_eq!(sent["timestamp"], 123);

        let closed = serde_json::to_value(NativeSignalEvent::Close {
            code: 1006,
            reason: "reset".into(),
            initiated_by: "transport".into(),
        })
        .unwrap();
        assert_eq!(closed["initiatedBy"], "transport");
    }
}
