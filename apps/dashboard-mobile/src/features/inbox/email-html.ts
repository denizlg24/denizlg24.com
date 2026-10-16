/**
 * Wraps a message's HTML for the web view. Remote content — tracking pixels
 * and images alike — is refused by the page's own CSP until asked for, and
 * scripts never run either way.
 */
export function emailDocument(
  html: string,
  { remote, dark }: { remote: boolean; dark: boolean },
) {
  const images = remote ? "img-src * data: cid:;" : "img-src data: cid:;";
  const policy = `default-src 'none'; ${images} style-src 'unsafe-inline' *; font-src * data:;`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  body { margin: 0; padding: 16px; font: -apple-system-body; word-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  pre { white-space: pre-wrap; }
</style>
</head>
<body>${html}</body>
</html>`;
}

/** Plain text as HTML, for messages that came without an HTML part. */
export function textAsHtml(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre style="font: inherit">${escaped}</pre>`;
}

/** Whether the HTML would load anything remote, so the toggle shows only then. */
export function hasRemoteContent(html: string) {
  return /<img[^>]+src=["']?https?:|url\(["']?https?:/i.test(html);
}

/** "Re: subject", without stacking prefixes. */
export function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/** The original quoted under a reply, as plain text. */
export function quoteOriginal(
  text: string,
  sender: string,
  date: string,
): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${new Date(date).toUTCString()}, ${sender} wrote:\n${quoted}`;
}
