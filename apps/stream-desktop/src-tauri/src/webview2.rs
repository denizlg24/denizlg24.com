use crate::content_blocker::{self, Ready};
use tauri::{Url, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Settings2, ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
};
use webview2_com::{
    take_pwstr, ContainsFullScreenElementChangedEventHandler, WebResourceRequestedEventHandler,
};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

/// WebView2 has no API to append to its user agent, so the default is read
/// back and rewritten. Element fullscreen only fills the webview's bounds
/// unless the host window follows it, which wry does not do.
pub fn configure(window: &WebviewWindow, suffix: &str, ready: Ready) -> tauri::Result<()> {
    let target = window.clone();
    let suffix = suffix.to_owned();
    window.with_webview(move |webview| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = webview.controller().CoreWebView2()?;
            let environment = webview.environment();
            // Cover requests made by documents, shared workers and service workers.
            // An outdated runtime fails closed instead of silently losing coverage.
            core.cast::<ICoreWebView2_22>()?
                .AddWebResourceRequestedFilterWithRequestSourceKinds(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )?;
            let mut request_token = 0;
            core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut uri = PWSTR::null();
                        args.Request()?.Uri(&mut uri)?;
                        if Url::parse(&take_pwstr(uri))
                            .is_ok_and(|url| content_blocker::blocks(&url))
                        {
                            let response = environment.CreateWebResourceResponse(
                                None,
                                403,
                                &HSTRING::from("Blocked"),
                                &HSTRING::from(
                                    "Content-Type: text/plain\r\nCache-Control: no-store\r\n",
                                ),
                            )?;
                            args.SetResponse(&response)?;
                        }
                    }
                    Ok(())
                })),
                &mut request_token,
            )?;

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
                &ContainsFullScreenElementChangedEventHandler::create(Box::new(
                    move |sender, _| {
                        if let Some(sender) = sender {
                            let mut fullscreen = BOOL::default();
                            sender.ContainsFullScreenElement(&mut fullscreen)?;
                            let _ = target.set_fullscreen(fullscreen.as_bool());
                        }
                        Ok(())
                    },
                )),
                &mut token,
            );
            Ok(())
        })();
        ready(result.map_err(|error| error.to_string()));
    })
}
