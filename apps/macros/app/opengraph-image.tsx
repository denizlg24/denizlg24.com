import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MACRO_COLORS } from "@repo/macros-core/macro-colors";
import { ImageResponse } from "next/og";

export const alt =
  "Macros — nutrition tracking for iPhone and Android. Know what you eat. Learn what you burn.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const iconData = await readFile(
  join(process.cwd(), "public/icon-512.png"),
  "base64",
);

const MACRO_BAR = [
  { color: MACRO_COLORS.protein, share: 23 },
  { color: MACRO_COLORS.carbs, share: 55 },
  { color: MACRO_COLORS.fat, share: 22 },
];

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        background: "#ffffff",
        color: "#0b0b0c",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <img
          src={`data:image/png;base64,${iconData}`}
          width={88}
          height={88}
          style={{ borderRadius: 20 }}
          alt=""
        />
        <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>
          Macros
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 84,
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: -3.5,
          }}
        >
          <span>Know what you eat.</span>
          <span style={{ color: "#6e6e73" }}>Learn what you burn.</span>
        </div>
        <div style={{ display: "flex", gap: 8, width: 520 }}>
          {MACRO_BAR.map((part) => (
            <div
              key={part.color}
              style={{
                height: 8,
                borderRadius: 4,
                background: part.color,
                width: `${part.share}%`,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 30, color: "#6e6e73" }}>
          For iPhone and Android
        </div>
      </div>
    </div>,
    size,
  );
}
