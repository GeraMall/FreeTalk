use std::{fs, time::SystemTime};
use tauri::Manager;

const MAX_DIAGNOSTIC_BYTES: usize = 2_000_000;

#[tauri::command]
pub fn save_connection_diagnostics(
    app: tauri::AppHandle,
    contents: String,
) -> Result<String, String> {
    if contents.len() > MAX_DIAGNOSTIC_BYTES {
        return Err("Журнал диагностики слишком большой".into());
    }
    let document: serde_json::Value =
        serde_json::from_str(&contents).map_err(|_| "Журнал диагностики повреждён")?;
    if document.get("schema").and_then(serde_json::Value::as_u64) != Some(1)
        || !document
            .get("entries")
            .is_some_and(serde_json::Value::is_array)
    {
        return Err("Неизвестный формат журнала диагностики".into());
    }

    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| "Не удалось определить время")?
        .as_secs();
    let directory = app
        .path()
        .desktop_dir()
        .map_err(|_| "Не удалось найти рабочий стол")?;
    let path = directory.join(format!("FreeTalk-diagnostics-{timestamp}.json"));
    fs::write(&path, contents).map_err(|_| "Не удалось сохранить журнал на рабочий стол")?;
    Ok(path.to_string_lossy().into_owned())
}
