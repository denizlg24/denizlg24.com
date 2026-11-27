"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { maxPictureBytes, pictureSize } from "@/lib/picture-format";

const maxSourceBytes = 25 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("This browser can't open that file. Try a JPEG or PNG."),
      );
    };
    image.src = url;
  });
}

function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crops the middle square and draws it at 256px. Safari cannot encode WebP
 * and hands back a PNG instead, so anything that isn't WebP is redone as JPEG.
 */
async function squarePicture(file: File): Promise<Blob> {
  const image = await loadImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side === 0) throw new Error("That picture is empty.");
  const canvas = document.createElement("canvas");
  canvas.width = pictureSize;
  canvas.height = pictureSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize pictures.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    pictureSize,
    pictureSize,
  );
  const webp = await encode(canvas, "image/webp", 0.86);
  const blob =
    webp?.type === "image/webp"
      ? webp
      : await encode(canvas, "image/jpeg", 0.86);
  if (!blob) throw new Error("The picture could not be prepared.");
  if (blob.size > maxPictureBytes)
    throw new Error("That picture is too large.");
  return blob;
}

async function errorFrom(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  return data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
    ? data.error
    : "The picture was not saved. Try again.";
}

export function ProfilePicture({
  name,
  initial,
}: {
  name: string;
  initial: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [picture, setPicture] = useState(initial);
  const [working, setWorking] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > maxSourceBytes) {
      setError("That file is over 25 MB. Choose a smaller photo.");
      return;
    }
    setWorking("upload");
    try {
      const blob = await squarePicture(file);
      const response = await fetch("/api/account/picture", {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "url" in data &&
        typeof data.url === "string"
      )
        setPicture(data.url);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  }

  async function remove() {
    setError("");
    setWorking("remove");
    try {
      const response = await fetch("/api/account/picture", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await errorFrom(response));
      setPicture(null);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="profile-picture">
      <span className="profile-picture-frame" aria-hidden={!picture}>
        {picture ? (
          // A same-origin route answering private bytes; next/image would
          // re-encode an already 256px square.
          <img src={picture} alt={name} width={72} height={72} />
        ) : (
          <span>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>
        )}
      </span>
      <div className="profile-picture-actions">
        <div className="row-actions">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a profile picture"
            onChange={upload}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={working !== null}
            aria-busy={working === "upload" || undefined}
            onClick={() => input.current?.click()}
          >
            {working === "upload"
              ? "Saving…"
              : picture
                ? "Change picture"
                : "Add a picture"}
          </Button>
          {picture ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={working !== null}
              aria-busy={working === "remove" || undefined}
              onClick={remove}
            >
              {working === "remove" ? "Removing…" : "Remove"}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="billing-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="meta">
            Shown in the top bar. We crop it to a square and keep a small copy.
          </p>
        )}
      </div>
    </div>
  );
}
