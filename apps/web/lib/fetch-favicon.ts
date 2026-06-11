export async function fetchFavicon(url: string): Promise<string | undefined> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.origin;

    const faviconPaths = [
      `${domain}/favicon.ico`,
      `${domain}/favicon.png`,
      `${domain}/apple-touch-icon.png`,
    ];

    for (const path of faviconPaths) {
      try {
        const response = await fetch(path, {
          method: "HEAD",
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          return path;
        }
      } catch {}
    }

    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return undefined;
  }
}
