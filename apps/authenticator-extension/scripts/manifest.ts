/**
 * Manifest generation for both stores.
 *
 * Chrome and Firefox agree on almost all of MV3, but not on how the background
 * runs (service worker vs. event page) or on extension identity, so the two
 * manifests are generated from one description rather than kept in sync by hand.
 */

export type ExtensionTarget = "chrome" | "firefox";

/** Stable id Firefox needs to sign and update the add-on. Never change it. */
export const FIREFOX_EXTENSION_ID = "authenticator@denizlg24.com";

/**
 * Set by the newest manifest key in use, not the oldest: `storage.session`
 * landed in 115 and `optional_host_permissions` in 128, but
 * `data_collection_permissions` needs 140 on desktop and 142 on Android. Older
 * releases would ignore that key rather than fail, so this is really a choice
 * to keep the validator quiet — cheap for an add-on that only ever runs on a
 * current browser.
 */
const FIREFOX_MIN_VERSION = "140.0";
const FIREFOX_ANDROID_MIN_VERSION = "142.0";

export interface ManifestOptions {
  target: ExtensionTarget;
  version: string;
  /** Origin the extension is allowed to talk to without an extra prompt. */
  apiOrigin: string;
}

interface ManifestJson {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  icons: Record<string, string>;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions?: string[];
  action: Record<string, unknown>;
  options_ui: Record<string, unknown>;
  background: Record<string, unknown>;
  commands: Record<string, unknown>;
  content_security_policy: Record<string, string>;
  browser_specific_settings?: Record<string, unknown>;
  minimum_chrome_version?: string;
}

/** Turns "https://denizlg24.com/api/admin" into the "https://denizlg24.com/*" match pattern. */
export function toMatchPattern(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  return `${url.protocol}//${url.host}/*`;
}

export function buildManifest({
  target,
  version,
  apiOrigin,
}: ManifestOptions): ManifestJson {
  const manifest: ManifestJson = {
    manifest_version: 3,
    name: "denizlg24 Authenticator",
    version,
    description:
      "Offline TOTP codes that stay in sync with the denizlg24.com authenticator.",
    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    // storage: the encrypted vault and settings.
    // alarms:  periodic background sync and the idle auto-lock timer.
    // clipboardWrite: copying a code out of the popup.
    permissions: ["storage", "alarms", "clipboardWrite"],
    // Only the server this extension syncs with. Anything else the owner points
    // it at is requested at runtime through optional_host_permissions.
    host_permissions: [apiOrigin],
    optional_host_permissions: ["https://*/*"],
    action: {
      default_popup: "popup.html",
      default_title: "Authenticator",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
      },
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    background:
      target === "firefox"
        ? { scripts: ["background.js"] }
        : { service_worker: "background.js" },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Alt+Shift+A",
          mac: "Alt+Shift+A",
        },
        description: "Open the authenticator",
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };

  if (target === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        // Required for new add-ons: it drives Firefox's built-in consent screen.
        // TOTP secrets and the API key leave the device for the configured
        // server, which is authentication information however self-hosted that
        // server is, so it is declared rather than claiming "none".
        data_collection_permissions: {
          required: ["authenticationInfo"],
        },
      },
      gecko_android: {
        strict_min_version: FIREFOX_ANDROID_MIN_VERSION,
      },
    };
  } else {
    manifest.minimum_chrome_version = "116";
  }

  return manifest;
}
