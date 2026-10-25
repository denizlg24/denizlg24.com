import { create } from "qrcode";
import { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

/** A QR code drawn as one SVG path, dark on light so every phone camera reads it. */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { path, count } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    const segments: string[] = [];
    for (let row = 0; row < modules.size; row++) {
      for (let column = 0; column < modules.size; column++) {
        if (modules.get(row, column))
          segments.push(`M${column} ${row}h1v1h-1z`);
      }
    }
    return { path: segments.join(""), count: modules.size };
  }, [value]);
  // Four modules of quiet zone, as the standard asks.
  const extent = count + 8;
  return (
    <Svg width={size} height={size} viewBox={`-4 -4 ${extent} ${extent}`}>
      <Rect x={-4} y={-4} width={extent} height={extent} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
