use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};
use tauri::WebviewWindow;

use crate::content_blocker::{self, Ready};

pub fn configure(window: &WebviewWindow, ready: Ready) -> tauri::Result<()> {
    window.with_webview(move |webview| unsafe {
        // Tauri calls this on the UI thread and owns the WKWebView for this window.
        let view = &*webview.inner().cast::<WKWebView>();
        let controller = view.configuration().userContentController();
        let Some(store) =
            WKContentRuleListStore::defaultStore(MainThreadMarker::new().expect("UI thread"))
        else {
            ready(Err("WebKit content rule store is unavailable".into()));
            return;
        };
        let callback = RcBlock::new(move |rules: *mut WKContentRuleList, error: *mut NSError| {
            if let Some(rules) = rules.as_ref() {
                controller.addContentRuleList(rules);
                ready(Ok(()));
            } else {
                let message = error
                    .as_ref()
                    .map(|error| error.localizedDescription().to_string())
                    .unwrap_or_else(|| "WebKit did not compile content rules".into());
                ready(Err(message));
            }
        });
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(&NSString::from_str("stream-ad-blocking-v1")),
            Some(&NSString::from_str(&content_blocker::webkit_rules())),
            Some(&callback),
        );
    })
}
