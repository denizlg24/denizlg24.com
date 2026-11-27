/** Limits and format checks shared by the upload route and the browser-side resize. */
export const maxPictureBytes = 256 * 1024;
export const pictureSize = 256;

export type PictureMime = "image/webp" | "image/jpeg" | "image/png";

const startsWith = (bytes: Uint8Array, offset: number, signature: number[]) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/** The type the bytes actually are, whatever the request claimed. */
export function sniffPicture(bytes: Uint8Array): PictureMime | null {
  if (
    startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  )
    return "image/webp";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  return null;
}

export const isPictureMime = (value: string): value is PictureMime =>
  value === "image/webp" || value === "image/jpeg" || value === "image/png";
