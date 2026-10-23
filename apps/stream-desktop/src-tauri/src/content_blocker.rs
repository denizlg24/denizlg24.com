use std::sync::Arc;
use tauri::Url;

pub type Ready = Arc<dyn Fn(Result<(), String>) + Send + Sync>;

pub fn domains() -> impl Iterator<Item = &'static str> {
    include_str!("blocked-domains.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

// This script forcibly blanks the player when it guesses devtools are open,
// including false positives in embedded webviews. Block its request, not media.
const BLOCKED_SCRIPT_PATH: &str = "/embed/iframe_player/assets/disable-devtool.js";

pub fn blocks(url: &Url) -> bool {
    if matches!(url.scheme(), "http" | "https") && url.path() == BLOCKED_SCRIPT_PATH {
        return true;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    domains().any(|domain| host == domain || host.ends_with(&format!(".{domain}")))
}

#[cfg(target_os = "macos")]
pub fn webkit_rules() -> String {
    let mut rules: Vec<_> = domains().map(|domain| {
        serde_json::json!({
            "trigger": { "url-filter": format!("^https?://([^/]*@)?([^/:@]+\\.)?{}(:[0-9]+)?/", domain.replace('.', "\\.")), "url-filter-is-case-sensitive": false },
            "action": { "type": "block" }
        })
    }).collect();
    rules.push(serde_json::json!({
        "trigger": { "url-filter": "^https?://[^/]+/embed/iframe_player/assets/disable-devtool\\.js([?].*)?$" },
        "action": { "type": "block" }
    }));
    serde_json::to_string(&rules).expect("serializable content rules")
}

/// Only the Stream top frame gets the capability flag. Subframes receive popup
/// guards, but cannot opt the web player out of its sandbox. The app does not
/// navigate to Stream until the native request filter is installed successfully.
pub fn initialization_script(home: &Url) -> String {
    format!(
        r#"(() => {{
  if (window.top === window && location.origin === {origin}) {{
    Object.defineProperty(window, '__STREAM_NATIVE_BLOCKER__', {{value: 1}});
  }}
  if (window.top === window) return;
  // Popunder scripts wrap the player's play handler and throw when a popup is
  // denied (null), which swallows the click. Hand them a decoy window instead;
  // the native host still denies any real window request.
  const decoy = new Proxy(function () {{}}, {{
    get: (_, key) =>
      key === 'closed' ? false
      : key === 'toString' || key === 'valueOf' ? () => ''
      : key === 'then' || typeof key === 'symbol' ? undefined
      : decoy,
    set: () => true,
    apply: () => decoy,
  }});
  Object.defineProperty(window, 'open', {{
    value: function open() {{ return decoy; }},
    writable: false,
    configurable: false,
  }});
  document.addEventListener('click', (event) => {{
    const link = event.target?.closest?.('a, area');
    if (link && ['_blank', '_top', '_parent'].includes(link.target.toLowerCase())) {{
      event.preventDefault();
      event.stopImmediatePropagation();
    }}
  }}, true);
  document.addEventListener('submit', (event) => {{
    if (event.target?.target && event.target.target.toLowerCase() !== '_self') {{
      event.preventDefault();
      event.stopImmediatePropagation();
    }}
  }}, true);
}})();"#,
        origin = serde_json::to_string(&home.origin().ascii_serialization()).unwrap()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_ad_hosts_and_subdomains_without_matching_url_text_or_lookalikes() {
        for domain in domains() {
            assert!(blocks(
                &Url::parse(&format!("https://{domain}/script.js")).unwrap()
            ));
            assert!(blocks(
                &Url::parse(&format!("https://ads.{domain}/script.js")).unwrap()
            ));
            assert!(!blocks(
                &Url::parse(&format!("https://{domain}.example/script.js")).unwrap()
            ));
            assert!(!blocks(
                &Url::parse(&format!("https://example.test/?next={domain}")).unwrap()
            ));
        }
        for url in [
            "https://vsembed.ru/embed/movie/tt0111161",
            "https://stellarconductornexus.com/embed/movie/tt0111161",
            "https://cdn.example.test/video.m3u8",
            "https://auth.denizlg24.com/login",
            "blob:https://vsembed.ru/123",
        ] {
            assert!(!blocks(&Url::parse(url).unwrap()), "{url}");
        }
    }

    #[test]
    fn blocks_only_the_intrusive_script_path_with_any_cache_query() {
        assert!(blocks(&Url::parse("https://stellarconductornexus.com/embed/iframe_player/assets/disable-devtool.js?v=123").unwrap()));
        for url in [
            "https://stellarconductornexus.com/embed/iframe_player/assets/player.js?v=123",
            "https://stellarconductornexus.com/embed/iframe_player/assets/vsdec.js",
            "https://example.test/?next=/embed/iframe_player/assets/disable-devtool.js",
            "https://example.test/embed/iframe_player/assets/disable-devtool.js.extra",
        ] {
            assert!(!blocks(&Url::parse(url).unwrap()), "{url}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn generates_webkit_block_rules_for_the_same_domains() {
        let rules: serde_json::Value = serde_json::from_str(&webkit_rules()).unwrap();
        assert_eq!(rules.as_array().unwrap().len(), domains().count() + 1);
        for rule in rules.as_array().unwrap() {
            assert_eq!(rule["action"]["type"], "block");
            assert!(rule["trigger"]["url-filter"]
                .as_str()
                .unwrap()
                .starts_with("^https?://"));
        }
    }
}
