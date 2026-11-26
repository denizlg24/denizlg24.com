import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadItem } from "./use-document-upload";

export function UploadList({
  items,
  onDismiss,
}: {
  items: UploadItem[];
  onDismiss: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="doc-uploads" aria-live="polite">
      {items.map((item) => (
        <li key={item.key} data-status={item.status}>
          {item.status === "error" ? (
            <CircleAlert aria-hidden />
          ) : (
            <LoaderCircle className="doc-spin" aria-hidden />
          )}
          <span className="doc-upload-name chat-truncate" title={item.name}>
            {item.name}
          </span>
          <span className="meta doc-upload-state" role={item.status === "error" ? "alert" : undefined}>
            {item.status === "error"
              ? item.error
              : item.status === "processing"
                ? "Extracting text…"
                : `${Math.round(item.progress * 100)}%`}
          </span>
          {item.status === "error" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Dismiss ${item.name}`}
              onClick={() => onDismiss(item.key)}
            >
              <X />
            </Button>
          ) : (
            <progress
              className="doc-progress"
              max={1}
              value={item.status === "processing" ? undefined : item.progress}
              aria-label={`Uploading ${item.name}`}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
