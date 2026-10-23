use tauri::Url;

const SIGN_IN_ORIGINS: [&str; 2] = ["https://auth.denizlg24.com", "https://api.denizlg24.com"];

// WKWebView reports subframe navigations to the same handler as top-level
// ones, so an embedded trailer would otherwise be cancelled and opened in the
// browser.
const EMBED_PREFIXES: [&str; 2] = [
    "https://www.youtube.com/embed/",
    "https://www.youtube-nocookie.com/embed/",
];

// `Url::origin` is opaque for custom schemes such as `shell://`, so two
// shell URLs would never compare equal through it.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

#[derive(Debug, PartialEq)]
pub enum Route {
    Allow,
    Retry,
    Reload(Option<Url>),
    External,
}

pub struct Shell {
    pub origin: Url,
    pub home: Url,
}

impl Shell {
    pub fn new(origin: Url, home: Url) -> Self {
        Self { origin, home }
    }

    pub fn offline_page(&self) -> Url {
        let mut url = self.origin.clone();
        url.set_query(Some("offline"));
        url
    }

    #[cfg(not(target_os = "macos"))]
    pub fn reload_page(&self) -> Url {
        self.origin.join("reload").expect("valid reload url")
    }

    pub fn is_stream(&self, url: &Url) -> bool {
        same_origin(url, &self.home)
    }

    pub fn route(&self, url: &Url) -> Route {
        if same_origin(url, &self.origin) {
            return match url.path() {
                "/retry" => Route::Retry,
                "/reload" => Route::Reload(
                    url.query_pairs()
                        .find(|(key, _)| key == "to")
                        .and_then(|(_, value)| Url::parse(&value).ok()),
                ),
                _ => Route::Allow,
            };
        }

        if matches!(url.scheme(), "about" | "blob" | "data") || self.is_stream(url) {
            return Route::Allow;
        }

        let origin = url.origin().ascii_serialization();
        if SIGN_IN_ORIGINS.contains(&origin.as_str())
            || EMBED_PREFIXES
                .iter()
                .any(|prefix| url.as_str().starts_with(prefix))
        {
            return Route::Allow;
        }

        Route::External
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell() -> Shell {
        Shell::new(
            Url::parse("shell://localhost/").unwrap(),
            Url::parse("https://stream.denizlg24.com").unwrap(),
        )
    }

    fn route(url: &str) -> Route {
        shell().route(&Url::parse(url).unwrap())
    }

    #[test]
    fn keeps_stream_and_sign_in_inside() {
        assert_eq!(
            route("https://stream.denizlg24.com/title/tt0111161"),
            Route::Allow
        );
        assert_eq!(route("https://auth.denizlg24.com/login?x=1"), Route::Allow);
        assert_eq!(
            route("https://api.denizlg24.com/api/auth/oauth2/authorize"),
            Route::Allow
        );
        assert_eq!(route("shell://localhost/?offline"), Route::Allow);
        assert_eq!(
            route("https://www.youtube-nocookie.com/embed/abc"),
            Route::Allow
        );
    }

    #[test]
    fn sends_everything_else_out() {
        assert_eq!(
            route("https://www.themoviedb.org/movie/278"),
            Route::External
        );
        assert_eq!(
            route("https://stream.denizlg24.com.evil.example/"),
            Route::External
        );
        assert_eq!(route("http://stream.denizlg24.com/"), Route::External);
        assert_eq!(
            route("https://www.youtube.com/watch?v=abc"),
            Route::External
        );
        assert_eq!(route("mailto:deniz@example.com"), Route::External);
    }

    #[test]
    fn reads_shell_actions() {
        assert_eq!(route("shell://localhost/retry"), Route::Retry);
        assert_eq!(
            route("shell://localhost/reload?to=https%3A%2F%2Fstream.denizlg24.com%2Fseries"),
            Route::Reload(Some(
                Url::parse("https://stream.denizlg24.com/series").unwrap()
            ))
        );
    }
}
