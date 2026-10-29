"use client";

import { useCallback, useEffect, useRef } from "react";

interface EmailIframeProps {
  html: string;
}

// The srcdoc is a separate document, so theme tokens do not reach it. Unstyled
// mail takes the host's resolved text colour instead of a fixed dark one that
// disappears on the dark theme.
function wrapEmailHtml(html: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          html, body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: var(--host-foreground, inherit);
            background: transparent;
            overflow-x: hidden;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          img { max-width: 100%; height: auto; }
          a { color: var(--host-link, inherit); }
          table { max-width: 100% !important; }
          pre, code { white-space: pre-wrap; word-wrap: break-word; }
          * { max-width: 100% !important; box-sizing: border-box; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;
}

export function EmailIframe({ html }: EmailIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    const host = getComputedStyle(iframe);
    doc.documentElement.style.setProperty("--host-foreground", host.color);
    doc.documentElement.style.setProperty(
      "--host-link",
      host.getPropertyValue("--accent-strong").trim() || host.color,
    );

    const resizeToContent = () => {
      iframe.style.height = `${doc.documentElement.scrollHeight + 16}px`;
    };
    resizeToContent();

    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(resizeToContent);
    observerRef.current.observe(doc.documentElement);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrapEmailHtml(html)}
      sandbox="allow-same-origin allow-popups"
      onLoad={handleLoad}
      className="min-h-50 w-full border-0 bg-transparent text-foreground"
      title="Email content"
    />
  );
}
