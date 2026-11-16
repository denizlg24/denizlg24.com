/** Public incident updates are plain text, with HTTP(S) references made clickable. */
export function incidentTextParts(text: string) {
  return text.split(/(https?:\/\/[^\s<>]+)/g).flatMap((part) => {
    if (!/^https?:\/\//.test(part)) return [{ text: part, href: null }];
    const href = part.replace(/[.,;!]+$/, "");
    try {
      const url = new URL(href);
      if (!url.hostname || url.username || url.password)
        return [{ text: part, href: null }];
      return [
        { text: href, href },
        { text: part.slice(href.length), href: null },
      ];
    } catch {
      return [{ text: part, href: null }];
    }
  });
}
