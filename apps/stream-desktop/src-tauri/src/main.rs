#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod navigation;
mod updater;
#[cfg(windows)]
mod webview2;

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::http::{header::CONTENT_TYPE, Response};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

use navigation::{Route, Shell};

const MAIN_WINDOW: &str = "main";
const SHELL_SCHEME: &str = "shell";
const SHELL_PAGE: &[u8] = include_bytes!("../../dist/index.html");
const REACHABILITY_TIMEOUT: Duration = Duration::from_secs(8);

struct State {
    shell: Shell,
    last: Mutex<Url>,
    client: reqwest::Client,
}

type Shared = Arc<State>;

fn shell_origin() -> Url {
    let origin = if cfg!(windows) {
        format!("http://{SHELL_SCHEME}.localhost/")
    } else {
        format!("{SHELL_SCHEME}://localhost/")
    };
    Url::parse(&origin).expect("valid shell origin")
}

fn home_url(app: &AppHandle) -> Url {
    let config = app.config();
    if cfg!(debug_assertions) {
        if let Some(dev) = &config.build.dev_url {
            return dev.clone();
        }
    }
    match config.app.windows.iter().find(|w| w.label == MAIN_WINDOW) {
        Some(window) => match &window.url {
            WebviewUrl::External(url) => url.clone(),
            other => panic!("main window url must be external, got {other}"),
        },
        None => panic!("tauri.conf.json has no main window"),
    }
}

fn user_agent_suffix(app: &AppHandle) -> String {
    format!("StreamDesktop/{}", app.package_info().version)
}

async fn reachable(state: &State) -> bool {
    matches!(
        state.client.get(state.shell.home.clone()).send().await,
        Ok(response) if !response.status().is_server_error()
    )
}

fn connect(app: &AppHandle, state: &Shared, to: Url) {
    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let target = if reachable(&state).await {
            to
        } else {
            state.shell.offline_page()
        };
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.navigate(target);
        }
    });
}

fn retry(app: &AppHandle, state: &Shared) {
    let last = state.last.lock().expect("last url lock").clone();
    connect(app, state, last);
}

fn reload(app: &AppHandle, state: &Shared, window: &WebviewWindow) {
    match window.url() {
        Ok(current) if state.shell.is_stream(&current) => connect(app, state, current),
        _ => retry(app, state),
    }
}

fn handle_route(app: &AppHandle, state: &Shared, url: &Url) -> bool {
    match state.shell.route(url) {
        Route::Allow => {
            if state.shell.is_stream(url) {
                *state.last.lock().expect("last url lock") = url.clone();
            }
            true
        }
        Route::Retry => {
            retry(app, state);
            false
        }
        Route::Reload(to) => {
            match to {
                Some(to) if state.shell.is_stream(&to) => connect(app, state, to),
                _ => retry(app, state),
            }
            false
        }
        Route::External => {
            let _ = app.opener().open_url(url.as_str(), None::<&str>);
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn shortcut_script(shell: &Shell) -> String {
    format!(
        r#"(() => {{
  if (window.top !== window) return;
  const reload = {reload:?};
  addEventListener("keydown", (event) => {{
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "r" || event.key === "R") {{
      event.preventDefault();
      location.href = reload + "?to=" + encodeURIComponent(location.href);
    }} else if (event.key === "[") {{
      event.preventDefault();
      history.back();
    }}
  }}, true);
}})();"#,
        reload = shell.reload_page().as_str()
    )
}

fn create_window(app: &AppHandle, state: &Shared) -> tauri::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .cloned()
        .expect("tauri.conf.json has no main window");
    config.url = WebviewUrl::CustomProtocol(state.shell.origin.clone());

    let nav_app = app.clone();
    let nav_state = state.clone();
    let popup_app = app.clone();
    let popup_state = state.clone();

    let builder = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| handle_route(&nav_app, &nav_state, url))
        .on_new_window(move |url, _features| {
            if let Route::Allow = popup_state.shell.route(&url) {
                if let Some(window) = popup_app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.navigate(url);
                }
            } else {
                let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        });

    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(&format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) {}",
        user_agent_suffix(app)
    ));

    #[cfg(not(target_os = "macos"))]
    let builder = builder.initialization_script(shortcut_script(&state.shell));

    let window = builder.build()?;

    #[cfg(windows)]
    webview2::configure(&window, &user_agent_suffix(app));

    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = user_agent_suffix;

    Ok(window)
}

#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let stream = SubmenuBuilder::new(app, "Stream")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("reload", "Reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("back", "Back")
                .accelerator("CmdOrCtrl+[")
                .build(app)?,
        )
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&stream, &edit, &view, &window])
        .build()
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main(app)
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(SHELL_SCHEME, |_ctx, _request| {
            Response::builder()
                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Cow::Borrowed(SHELL_PAGE))
                .expect("static response")
        });

    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|app, event| {
        let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
            return;
        };
        match event.id().as_ref() {
            "reload" => reload(app, &app.state::<Shared>(), &window),
            "back" => {
                let _ = window.eval("history.back()");
            }
            _ => {}
        }
    });

    builder
        .setup(|app| {
            let handle = app.handle();
            let home = home_url(handle);
            let client = reqwest::Client::builder()
                .timeout(REACHABILITY_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(user_agent_suffix(handle))
                .build()?;
            let state: Shared = Arc::new(State {
                shell: Shell::new(shell_origin(), home.clone()),
                last: Mutex::new(home.clone()),
                client,
            });
            app.manage(state.clone());

            create_window(handle, &state)?;
            connect(handle, &state, home);

            if !cfg!(debug_assertions) {
                updater::spawn(handle.clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Stream");
}
