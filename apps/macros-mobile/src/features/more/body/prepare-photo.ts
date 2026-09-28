import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { PreparedBodyPhoto } from "@/api/body";

const MAX_DIMENSION = 1600;
/** The server refuses anything larger once it lands in storage. */
const MAX_BYTES = 3_000_000;

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Downscale and re-encode on the device. Re-encoding through the manipulator
 * writes a bare JPEG, so the camera's EXIF — GPS included — never leaves the
 * phone, and the upload is a few hundred kilobytes instead of several MB.
 */
export async function prepareBodyPhoto(source: {
  uri: string;
  width: number;
  height: number;
}): Promise<PreparedBodyPhoto> {
  const context = ImageManipulator.manipulate(source.uri);
  const longest = Math.max(source.width, source.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    context.resize(
      source.width >= source.height
        ? { width: Math.round(source.width * scale) }
        : { height: Math.round(source.height * scale) },
    );
  }
  const image = await context.renderAsync();

  let saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.84,
  });
  if (new File(saved.uri).size > MAX_BYTES) {
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
  }
  image.release();
  context.release();

  const bytes = await new File(saved.uri).bytes();
  const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    sha256: toHex(hash),
  };
}
