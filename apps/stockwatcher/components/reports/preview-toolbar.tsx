"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ShareControl } from "./share-control";

export function PreviewToolbar({
  id,
  kind,
  shareUrl,
  theme,
}: {
  id: string;
  kind: "report" | "deck";
  shareUrl: string | null;
  theme: "light" | "dark" | "system" | "terminal";
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="preview-toolbar" role="toolbar" aria-label="Report actions">
      <Button asChild variant="ghost" size="sm">
        <Link href="/#reports">
          <ArrowLeft aria-hidden /> Reports
        </Link>
      </Button>
      <span className="preview-toolbar-label">
        {kind === "deck" ? "Deck preview" : "Report preview"} ·{" "}
        {shareUrl ? "Shared by link" : "Private"}
      </span>
      <span className="preview-toolbar-actions">
        <ShareControl id={id} shareUrl={shareUrl} compact />
        {kind === "report" ? (
          <Button variant="ghost" size="xs" onClick={() => window.print()}>
            <Printer aria-hidden /> PDF
          </Button>
        ) : null}
      </span>
    </div>
  );
}
