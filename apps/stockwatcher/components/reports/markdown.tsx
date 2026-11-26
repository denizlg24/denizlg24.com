"use client";

import { memo } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { markdownComponents } from "@/components/assistant/markdown";

const rehypePlugins = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== "raw")
  .map(([, plugin]) => plugin);
const controls = {
  table: false,
  code: false,
  mermaid: false,
  image: false,
} as const;
const linkSafety = { enabled: false };

export const ReportMarkdown = memo(function ReportMarkdown({
  text,
  className = "doc-prose",
}: {
  text: string;
  className?: string;
}) {
  return (
    <Streamdown
      className={className}
      mode="static"
      skipHtml
      rehypePlugins={rehypePlugins}
      components={markdownComponents}
      controls={controls}
      linkSafety={linkSafety}
      lineNumbers={false}
      tableMaxHeight={0}
    >
      {text}
    </Streamdown>
  );
});
