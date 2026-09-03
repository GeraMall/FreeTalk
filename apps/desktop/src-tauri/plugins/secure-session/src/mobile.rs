use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

const PLUGIN_IDENTIFIER: &str = "io.freetalk.securesession";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SecureSession<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SecureSessionPlugin")?;
    Ok(SecureSession(handle))
}

pub struct SecureSession<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetRequest<'a> {
    refresh_token: &'a str,
}

#[derive(Deserialize)]
struct GetResponse {
    value: Option<String>,
}

impl<R: Runtime> SecureSession<R> {
    pub fn set(&self, refresh_token: &str) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<()>("set", SetRequest { refresh_token })
            .map_err(Into::into)
    }

    pub fn get(&self) -> crate::Result<Option<String>> {
        self.0
            .run_mobile_plugin::<GetResponse>("get", ())
            .map(|response| response.value)
            .map_err(Into::into)
    }

    pub fn clear(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<()>("clear", ())
            .map_err(Into::into)
    }
}
