"use client";

import { Button } from "@repo/ui/button";
import { Upload } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAdmin } from "../provider";

const uploadSchema = z.object({ url: z.string() });

/** Uploads a file to the cloud's `image` bucket through `POST /upload`; its public URL. */
export function useUpload() {
  const { client } = useAdmin();
  return async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return uploadSchema.parse(await client.upload("upload", form)).url;
  };
}

/** A button that picks a file, uploads it and hands back its URL. */
export function UploadButton({
  accept,
  onUploaded,
  label = "Upload",
  variant = "ghost",
  size = "sm",
  className,
}: {
  accept?: string;
  onUploaded: (url: string, file: File) => void;
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const upload = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy}
        className={className}
        onClick={() => input.current?.click()}
      >
        <Upload />
        {busy ? "Uploading" : label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={async (event) => {
          const target = event.currentTarget;
          const file = target.files?.[0];
          target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onUploaded(await upload(file), file);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Upload failed",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
