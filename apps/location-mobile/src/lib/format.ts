/** Terse renderings shared by the screen; pure so they can be tested. */

export function coordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function accuracy(metres: number) {
  return metres >= 1_000
    ? `±${(metres / 1_000).toFixed(1)} km`
    : `±${Math.round(metres)} m`;
}

export function duration(minutes: number) {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function clock(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1_000);
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "850 m", "3.4 km": the same rounding the widgets use. */
export function distance(metres: number) {
  return metres < 1_000
    ? `${Math.round(metres)} m`
    : `${(metres / 1_000).toFixed(1)} km`;
}

/** "8,400 m²" below a tenth of a square kilometre, else "1.24 km²". */
export function area(squareMetres: number) {
  return squareMetres < 100_000
    ? `${Math.round(squareMetres).toLocaleString("en-GB")} m²`
    : `${(squareMetres / 1_000_000).toFixed(2)} km²`;
}

/** `1:05:09` while running, `12:04` under an hour. */
export function elapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
