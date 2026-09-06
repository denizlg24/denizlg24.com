import { ImageResponse } from "next/og";
export const alt =
  "deniz status — Service health, backups, and incident updates";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "70px 80px",
        background: "#f9f8f6",
        color: "#303630",
      }}
    >
      <div style={{ display: "flex", fontSize: 28 }}>deniz / status</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 62, letterSpacing: -2 }}>
          A little peace of mind.
        </div>
        <div style={{ fontSize: 27, color: "#647560", marginTop: 24 }}>
          Service health. Backups. The full story.
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {Array.from({ length: 70 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 36,
              background: "#a1bc98",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    </div>,
    size,
  );
}
