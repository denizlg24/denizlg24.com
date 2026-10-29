"use client";

import { Button } from "@repo/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { Slider } from "@repo/ui/slider";
import { Spinner } from "@repo/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@repo/ui/toggle-group";
import { Circle, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";

type CropShape = "square" | "circle";

/** Keep exports small — logos render at ≤48px, and /upload caps files at 5MB. */
const MAX_OUTPUT_SIZE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

async function cropToBlob(
  src: string,
  area: Area,
  shape: CropShape,
): Promise<Blob> {
  const img = await loadImage(src);
  const scale = Math.min(
    1,
    MAX_OUTPUT_SIZE / Math.max(area.width, area.height),
  );
  const width = Math.max(1, Math.round(area.width * scale));
  const height = Math.max(1, Math.round(area.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported");

  if (shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      width / 2,
      height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.clip();
  }
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    width,
    height,
  );

  // PNG keeps the transparent corners of a circle crop
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to export image")),
      "image/png",
    );
  });
}

export function ImageCropDialog({
  src,
  open,
  onOpenChange,
  onCropped,
  onUseOriginal,
}: {
  /** Object URL of the picked file. */
  src: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the cropped image as a PNG blob. */
  onCropped: (blob: Blob) => void;
  /** Skip cropping and keep the file as picked. */
  onUseOriginal?: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [shape, setShape] = useState<CropShape>("square");
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!src) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
  }, [src]);

  const handleCropComplete = useCallback((_area: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  const handleApply = async () => {
    if (!areaPixels) return;
    setExporting(true);
    try {
      const blob = await cropToBlob(src, areaPixels, shape);
      onCropped(blob);
    } catch {
      toast.error("Failed to crop image");
    }
    setExporting(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Block Escape/overlay close mid-export so onCropped can't fire after cancel.
        if (!o && exporting) return;
        onOpenChange(o);
      }}
    >
      {/* Hand-built rather than FormDialog: the cropper measures its container
          on mount, so the dialog must not zoom in, and FormDialog does not
          take a content className to switch that animation off. */}
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col gap-0 overflow-hidden p-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
      >
        <div className="shrink-0 border-b px-5 pt-4 pb-3 pr-12">
          <DialogTitle>Crop image</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="relative h-[min(55vh,32rem)] w-full overflow-hidden rounded-md bg-surface">
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape={shape === "circle" ? "round" : "rect"}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>
          <div className="flex items-center gap-4">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={shape}
              onValueChange={(value) => {
                if (value === "square" || value === "circle") setShape(value);
              }}
            >
              <ToggleGroupItem value="square" aria-label="Square">
                <Square className="size-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="circle" aria-label="Circle">
                <Circle className="size-3.5" />
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="flex flex-1 items-center gap-3">
              <span className="shrink-0 text-xs text-muted-foreground">
                Zoom
              </span>
              <Slider
                value={[zoom]}
                min={1}
                max={4}
                step={0.05}
                onValueChange={([value]) =>
                  value !== undefined && setZoom(value)
                }
              />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {zoom.toFixed(1)}×
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {onUseOriginal && (
              <Button
                variant="outline"
                onClick={onUseOriginal}
                disabled={exporting}
              >
                Use original
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={exporting || !areaPixels}>
            {exporting && <Spinner className="size-3.5" />}
            Crop &amp; upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
