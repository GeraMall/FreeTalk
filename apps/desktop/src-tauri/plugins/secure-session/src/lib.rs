use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
use tauri::Manager;

#[cfg(mobile)]
mod mobile;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-session")
        .setup(|_app, _api| {
            #[cfg(mobile)]
            _app.manage(mobile::init(_app, _api)?);
            Ok(())
        })
        .build()
}

#[cfg(mobile)]
pub use mobile::SecureSession;
