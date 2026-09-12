#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

#[tauri::command]
fn toggle_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
}

const OAUTH_CALLBACK_EVENT: &str = "oauth-callback";
const OAUTH_CALLBACK_PATH: &str = "/callback";
const OAUTH_LISTEN_TIMEOUT: Duration = Duration::from_secs(300);

const OAUTH_DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>denizlg24</title>\
<body style=\"font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5\">\
<p>Signed in. You can close this tab.</p><script>setTimeout(()=>window.close(),800)</script>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Binds an ephemeral loopback port for the OAuth redirect (RFC 8252 §7.3)
/// and returns it. The first request to `/callback` is answered with a page,
/// re-emitted to the webview as `oauth-callback` with the full URL, and ends
/// the listener; anything else (a favicon probe) is refused and the wait goes
/// on. The thread gives up on its own after five minutes so an abandoned
/// sign-in does not pin a port for the life of the process.
#[tauri::command]
fn oauth_listen(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let deadline = Instant::now() + OAUTH_LISTEN_TIMEOUT;
        while Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(accepted) => accepted,
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                Err(_) => return,
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

            let mut buf = [0u8; 8192];
            let read = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..read]);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/")
                .to_string();

            if !target.starts_with(OAUTH_CALLBACK_PATH) {
                respond(&mut stream, "404 Not Found", "");
                continue;
            }

            respond(&mut stream, "200 OK", OAUTH_DONE_PAGE);
            let _ = app.emit(
                OAUTH_CALLBACK_EVENT,
                format!("http://127.0.0.1:{port}{target}"),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            return;
        }
    });

    Ok(port)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![toggle_devtools, oauth_listen])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
