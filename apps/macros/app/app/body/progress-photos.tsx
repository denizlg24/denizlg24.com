"use client";

import { Button } from "@repo/ui/button";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { prepareBodyPhoto } from "@/lib/body/photo-client";

type Angle = "front" | "left" | "right" | "back";
type Photo = {
  id: string;
  angle: Angle;
  url: string;
  logDate: string;
  weightKg: number;
};
const angles = [
  { value: "front", label: "Front" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "back", label: "Back" },
] satisfies Array<{ value: Angle; label: string }>;

export function ProgressPhotos() {
  const [angle, setAngle] = useState<Angle>("front");
  const [selected, setSelected] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["body-photos", angle],
    queryFn: async () => {
      const response = await fetch(`/api/body/photos?angle=${angle}`);
      if (!response.ok) throw new Error("Could not load photos");
      return ((await response.json()) as { photos: Photo[] }).photos;
    },
  });
  const photos = query.data ?? [];
  const current = photos[Math.min(selected, Math.max(photos.length - 1, 0))];
  const comparison = photos.length > 1 ? photos.at(-1) : null;

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareBodyPhoto(file);
      const reservation = await fetch("/api/body/photos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ angle, mimeType: "image/jpeg" }),
      });
      const reservationBody = (await reservation.json()) as {
        uploadUrl?: string;
        storageKey?: string;
        error?: string;
      };
      if (
        !reservation.ok ||
        !reservationBody.uploadUrl ||
        !reservationBody.storageKey
      )
        throw new Error(reservationBody.error ?? "Could not start upload");
      const uploaded = await fetch(reservationBody.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: prepared.blob,
      });
      if (!uploaded.ok) throw new Error("Photo upload failed");
      const completed = await fetch("/api/body/photos", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageKey: reservationBody.storageKey,
          angle,
          width: prepared.width,
          height: prepared.height,
          sha256: prepared.sha256,
          capturedAt: new Date().toISOString(),
        }),
      });
      if (!completed.ok) throw new Error("Could not save photo metadata");
      setSelected(0);
      await queryClient.invalidateQueries({ queryKey: ["body-photos", angle] });
      navigator.vibrate?.(20);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload photo",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Camera className="size-5 text-primary" />
        <h2 className="text-lg font-bold">Progress photos</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Use the same distance, lighting, and angle. Images are resized locally
        and location metadata is removed before upload.
      </p>
      <SegmentedControl
        ariaLabel="Photo angle"
        value={angle}
        options={angles}
        onValueChange={(value) => {
          setAngle(value);
          setSelected(0);
        }}
      />
      {current ? (
        <div className="grid grid-cols-2 gap-2">
          <PhotoCard
            photo={comparison ?? current}
            label={comparison ? "First" : "Current"}
          />
          <PhotoCard
            photo={current}
            label={comparison ? "Selected" : "Current"}
          />
        </div>
      ) : (
        <div className="flex aspect-[3/2] items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          No {angle} photo yet
        </div>
      )}
      {photos.length > 1 ? (
        <input
          aria-label="Photo timeline"
          type="range"
          min={0}
          max={photos.length - 1}
          value={Math.min(selected, photos.length - 1)}
          onChange={(event) => setSelected(Number(event.target.value))}
          className="w-full"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Take photo"}
        </Button>
        {current ? (
          <Button
            variant="outline"
            size="icon"
            aria-label="Delete selected photo"
            onClick={async () => {
              if (!confirm("Delete this progress photo permanently?")) return;
              const response = await fetch(`/api/body/photos/${current.id}`, {
                method: "DELETE",
              });
              if (response.ok) {
                setSelected(0);
                await queryClient.invalidateQueries({
                  queryKey: ["body-photos", angle],
                });
                navigator.vibrate?.(20);
              }
            }}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PhotoCard({ photo, label }: { photo: Photo; label: string }) {
  return (
    <figure className="relative overflow-hidden rounded-xl bg-muted">
      <img
        src={photo.url}
        alt={`${photo.angle} progress on ${photo.logDate}`}
        className="aspect-[3/4] w-full object-cover"
      />
      <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 p-2 text-xs text-white">
        <span className="font-semibold">{label}</span> · {photo.logDate} ·{" "}
        {photo.weightKg.toFixed(1)} kg
      </figcaption>
    </figure>
  );
}
