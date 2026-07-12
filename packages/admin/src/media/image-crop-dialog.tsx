"use client";

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Label } from "@repo/ui/label";
import { Slider } from "@repo/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@repo/ui/toggle-group";
import { Circle, Loader2, Square } from "lucide-react";
import { useCallback, useState } from "react";
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
      {/* no scale animation: the cropper measures its container on mount and
          a zooming dialog makes it measure mid-animation */}
      <DialogContent className="sm:max-w-md gap-4 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100">
        <DialogHeader>
          <DialogTitle className="text-sm">Crop Image</DialogTitle>
          <DialogDescription className="text-xs">
            Drag to position, scroll or use the slider to zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-md bg-muted">
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
            onValueChange={(v) => v && setShape(v as CropShape)}
          >
            <ToggleGroupItem value="square" title="Square crop">
              <Square className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="circle" title="Circle crop">
              <Circle className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex flex-1 items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">
              Zoom
            </Label>
            <Slider
              value={[zoom]}
              min={1}
              max={4}
              step={0.05}
              onValueChange={([v]) => v !== undefined && setZoom(v)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          {onUseOriginal && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={onUseOriginal}
              disabled={exporting}
            >
              Use Original
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleApply}
            disabled={exporting || !areaPixels}
          >
            {exporting && <Loader2 className="size-3.5 animate-spin" />}
            Crop &amp; Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
