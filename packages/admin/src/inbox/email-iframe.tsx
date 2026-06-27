"use client";

import { useCallback, useRef } from "react";

interface EmailIframeProps {
  html: string;
}

export function EmailIframe({ html }: EmailIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const resizeToContent = () => {
      const height = doc.documentElement.scrollHeight;
      iframe.style.height = `${height + 16}px`;
    };

    resizeToContent();

    const observer = new ResizeObserver(resizeToContent);
    observer.observe(doc.documentElement);

    return () => observer.disconnect();
  }, []);

  const wrappedHtml = `
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
            color: #1a1a1a;
            background: transparent;
            overflow-x: hidden;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          img { max-width: 100%; height: auto; }
          a { color: #2563eb; }
          table { max-width: 100% !important; }
          pre, code { white-space: pre-wrap; word-wrap: break-word; }
          * { max-width: 100% !important; box-sizing: border-box; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      sandbox="allow-same-origin allow-popups"
      onLoad={handleLoad}
      className="w-full border-0 min-h-50 bg-transparent"
      title="Email content"
    />
  );
}
