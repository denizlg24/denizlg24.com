const FINANCE_LINK_REDIRECT_URL =
  "https://denizlg24.com/api/admin/finance/callback";

/**
 * The OAuth callback Enable Banking sends the browser back to.
 *
 * This is deliberately hardcoded. Bank redirect URLs are an external contract
 * whitelisted in Enable Banking, and allowing a build-time site-origin value to
 * change it sent desktop-created authorisations back to localhost.
 */
export function financeLinkRedirectUrl() {
  return FINANCE_LINK_REDIRECT_URL;
}
