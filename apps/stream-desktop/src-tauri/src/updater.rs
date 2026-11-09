use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// The window is often left open for days, so a check at launch alone would
/// never see a release. "Later" holds until the next version appears.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut declined: Option<String> = None;
        loop {
            if let Err(error) = tauri::async_runtime::block_on(run(&app, &mut declined)) {
                eprintln!("update check failed: {error}");
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

async fn run(
    app: &AppHandle,
    declined: &mut Option<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    if declined.as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }

    let accepted = app
        .dialog()
        .message(format!(
            "Stream {} is ready to install. Stream will restart when it's done.",
            update.version
        ))
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install".into(),
            "Later".into(),
        ))
        .blocking_show();
    if !accepted {
        *declined = Some(update.version.clone());
        return Ok(());
    }

    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}
