export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Browsers, phones and desktop recorders disagree on the label for the same
// container, so the aliases are listed rather than the extension being trusted
// on its own — the extension check still has to pass alongside this.
const ALLOWED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
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
