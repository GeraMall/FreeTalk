use std::{fs, time::SystemTime};
use tauri::Manager;

const MAX_DIAGNOSTIC_BYTES: usize = 2_000_000;

fn validate_diagnostic_document(document: &serde_json::Value) -> bool {
    let schema = document.get("schema").and_then(serde_json::Value::as_u64);
    let has_entries = document
        .get("entries")
        .is_some_and(serde_json::Value::is_array);

    match schema {
        Some(1) => has_entries,
        Some(2) => {
            has_entries
                && document
                    .get("diagnosticSchemaVersion")
                    .and_then(serde_json::Value::as_u64)
                    == Some(2)
                && document
                    .get("appVersion")
                    .is_some_and(serde_json::Value::is_string)
                && document
                    .get("buildCommit")
                    .is_some_and(serde_json::Value::is_string)
        }
        _ => false,
    }
}

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
    if !validate_diagnostic_document(&document) {
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

#[cfg(test)]
mod tests {
    use super::validate_diagnostic_document;
    use serde_json::json;

    #[test]
    fn accepts_current_schema_two_export() {
        assert!(validate_diagnostic_document(&json!({
            "schema": 2,
            "diagnosticSchemaVersion": 2,
            "appVersion": "0.3.11",
            "buildCommit": "test-commit",
            "entries": []
        })));
    }

    #[test]
    fn keeps_legacy_schema_one_compatible() {
        assert!(validate_diagnostic_document(&json!({
            "schema": 1,
            "entries": []
        })));
    }

    #[test]
    fn rejects_incomplete_or_unknown_exports() {
        assert!(!validate_diagnostic_document(&json!({
            "schema": 2,
            "diagnosticSchemaVersion": 2,
            "entries": []
        })));
        assert!(!validate_diagnostic_document(&json!({
            "schema": 3,
            "entries": []
        })));
    }
}
