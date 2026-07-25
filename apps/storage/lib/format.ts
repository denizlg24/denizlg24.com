// The API snake-cases every name it stores, so a rename field that echoes the
// raw input would promise something the server will not honour.
export function normalizeNamePreview(name: string): string {
  return name
    .replace(/[\s-]+/g, "_")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function normalizeFileNamePreview(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return normalizeNamePreview(name);
  return `${normalizeNamePreview(name.slice(0, dotIndex))}.${name
    .slice(dotIndex + 1)
    .toLowerCase()}`;
}
