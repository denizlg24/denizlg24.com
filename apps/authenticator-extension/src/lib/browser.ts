/**
 * Single import point for the WebExtension API.
 *
 * `webextension-polyfill` hands back Firefox's native promise-based `browser`
 * when it exists and wraps Chrome's callback API otherwise, so the rest of the
 * code never branches on the browser.
 */

import browser from "webextension-polyfill";

export { browser };

export const EXTENSION_TARGET = __EXT_TARGET__;
export const EXTENSION_VERSION = __EXT_VERSION__;

export function openOptionsPage(): Promise<void> {
  return browser.runtime.openOptionsPage();
}

/** Match pattern for a base URL, e.g. "https://denizlg24.com/*". */
export function originPattern(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  return `${url.protocol}//${url.host}/*`;
}

export async function hasHostPermission(apiBaseUrl: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({
      origins: [originPattern(apiBaseUrl)],
    });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture; browsers reject silent permission grants. */
export async function requestHostPermission(
  apiBaseUrl: string,
): Promise<boolean> {
  return browser.permissions.request({
    origins: [originPattern(apiBaseUrl)],
  });
}
