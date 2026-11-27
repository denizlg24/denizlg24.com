"use client";

import type { ReactNode } from "react";
import { ToolContent, ToolHeader } from "@/components/ai-elements/tool";

export function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chat-tool">
      <ToolHeader title={title} meta={meta} />
      <ToolContent>{children}</ToolContent>
    </div>
  );
}
