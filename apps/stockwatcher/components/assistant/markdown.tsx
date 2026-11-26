"use client";

import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

function Link({ href, title, children }: ComponentProps<"a">) {
  if (typeof href !== "string" || !/^(?:https?:\/\/|mailto:)/i.test(href))
    return <span title={title}>{children}</span>;
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  );
}

function Image({ src, alt }: ComponentProps<"img">) {
  const label = alt?.trim() || "image";
  return typeof src === "string" && /^https?:\/\//i.test(src) ? (
    <a href={src} target="_blank" rel="noopener noreferrer">
      [{label}]
    </a>
  ) : (
    <span>[{label}]</span>
  );
}

export const markdownComponents = { a: Link, img: Image };
const components = markdownComponents;
const controls = {
  table: { copy: true, download: false, fullscreen: false },
  code: { copy: true, download: false },
  mermaid: false,
  image: false,
} as const;
const linkSafety = { enabled: false };

export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <Streamdown
      className="chat-prose"
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      components={components}
      controls={controls}
      linkSafety={linkSafety}
      lineNumbers={false}
      tableMaxHeight={0}
      codeBlockMaxHeight={320}
    >
      {text}
    </Streamdown>
  );
});
