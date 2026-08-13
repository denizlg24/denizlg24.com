const GENERATED_DEPLOYMENT_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-[a-z0-9]{6}\.denizlg24\.com$/;

/** Refuse arbitrary post-login redirects; only generated deployment names pass. */
export function safePreviewReturnTo(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !GENERATED_DEPLOYMENT_HOST.test(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
