use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings2;
use webview2_com::{take_pwstr, ContainsFullScreenElementChangedEventHandler};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

/// WebView2 has no API to append to its user agent, so the default is read
/// back and rewritten. Element fullscreen only fills the webview's bounds
/// unless the host window follows it, which wry does not do.
pub fn configure(window: &WebviewWindow, suffix: &str) {
    let target = window.clone();
    let suffix = suffix.to_owned();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };

        if let Ok(settings) = core
            .Settings()
            .and_then(|settings| settings.cast::<ICoreWebView2Settings2>())
        {
            let mut agent = PWSTR::null();
            if settings.UserAgent(&mut agent).is_ok() {
                let current = take_pwstr(agent);
                let _ = settings.SetUserAgent(&HSTRING::from(format!("{current} {suffix}")));
            }
        }

        let mut token = Default::default();
        let _ = core.add_ContainsFullScreenElementChanged(
            &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut fullscreen = BOOL::default();
                    sender.ContainsFullScreenElement(&mut fullscreen)?;
                    let _ = target.set_fullscreen(fullscreen.as_bool());
                }
                Ok(())
            })),
            &mut token,
        );
    });
}
