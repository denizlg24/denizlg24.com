import {
  type MacrosRecipeImageUploadResponse,
  macrosRecipeImageUploadResponseSchema,
} from "@repo/schemas/macros";

const MAX_BYTES = 3_000_000;
const ATTEMPTS = [
  { edge: 2400, quality: 0.86 },
  { edge: 2000, quality: 0.8 },
  { edge: 1600, quality: 0.74 },
  { edge: 1200, quality: 0.7 },
];

function encode(bitmap: ImageBitmap, edge: number, quality: number) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can’t prepare photos.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn’t prepare the photo.")),
      "image/jpeg",
      quality,
    ),
  );
}

/**
 * Re-encoding through a canvas is the point, not a side effect: it turns any
 * format the browser can decode into a JPEG and drops EXIF, including GPS.
 */
export async function uploadRecipeImage(
  file: File,
): Promise<MacrosRecipeImageUploadResponse> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo file.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That photo couldn’t be opened. Try a JPEG or PNG.");
  });
  let blob: Blob | null = null;
  try {
    for (const attempt of ATTEMPTS) {
      blob = await encode(bitmap, attempt.edge, attempt.quality);
      if (blob.size <= MAX_BYTES) break;
    }
  } finally {
    bitmap.close();
  }
  if (!blob || blob.size > MAX_BYTES)
    throw new Error("That photo is too large even after resizing.");

  const response = await fetch("/api/recipes/images", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String(json.error)
        : "Upload failed.";
    throw new Error(message);
  }
  return macrosRecipeImageUploadResponseSchema.parse(json);
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
