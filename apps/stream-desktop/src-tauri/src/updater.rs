use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(app).await {
            eprintln!("update check failed: {error}");
        }
    });
}

async fn run(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let dialog = app
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
        ));
    let accepted = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await?;
    if !accepted {
        return Ok(());
    }

    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}
