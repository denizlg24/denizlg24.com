export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-m4a",
]);
const ALLOWED_EXTENSIONS = new Set([
  ".webm",
  ".ogg",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".wav",
]);

function extension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function isSupportedAudio(file: File) {
  const mime = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    ALLOWED_MIME_TYPES.has(mime) && ALLOWED_EXTENSIONS.has(extension(file.name))
  );
}
