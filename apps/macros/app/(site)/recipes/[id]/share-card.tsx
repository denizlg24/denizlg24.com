import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MACRO_COLORS } from "@repo/macros-core/macro-colors";
import { ImageResponse } from "next/og";
import { macroEnergyShares, ogTitleSize } from "@/lib/recipes/og";

const [iconData, serifData, sansData] = await Promise.all([
  readFile(join(process.cwd(), "public/icon-512.png"), "base64"),
  readFile(join(process.cwd(), "assets/fonts/SourceSerif4-Semibold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Inter-Medium.ttf")),
]);

const INK = "#0b0b0c";
const MUTED = "#6e6e73";
const HAIRLINE = "#e5e5ea";

function Macro({
  label,
  grams,
  color,
}: {
  label: string;
  grams: number;
  color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{ width: 14, height: 14, borderRadius: 7, background: color }}
      />
      <span style={{ color: MUTED }}>{label}</span>
      <span>{Math.round(grams)} g</span>
    </div>
  );
}

export type ShareCard = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  cover: string | null;
};

export function renderRecipeShareCard(
  { name, calories, cover, ...macros }: ShareCard,
  size: { width: number; height: number },
) {
  const shares = macroEnergyShares(macros);
  const bar = [
    { color: MACRO_COLORS.protein, share: shares.protein },
    { color: MACRO_COLORS.carbs, share: shares.carbs },
    { color: MACRO_COLORS.fat, share: shares.fat },
  ].filter((part) => part.share > 0);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#ffffff",
        color: INK,
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: cover ? "56px 56px 52px 64px" : "64px 80px 60px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img
            src={`data:image/png;base64,${iconData}`}
            width={56}
            height={56}
            style={{ borderRadius: 13 }}
            alt=""
          />
          <span style={{ fontSize: 28, letterSpacing: -0.5 }}>Macros</span>
          <span style={{ fontSize: 28, color: MUTED }}>Recipes</span>
        </div>

        <div
          style={{
            display: "block",
            fontFamily: "Source Serif",
            fontSize: ogTitleSize(name, Boolean(cover)),
            lineHeight: 1.08,
            letterSpacing: -1.5,
            lineClamp: 3,
          }}
        >
          {name}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 56, letterSpacing: -1.5 }}>
              {Math.round(calories)}
            </span>
            <span style={{ fontSize: 26, color: MUTED }}>kcal per serving</span>
          </div>
          {bar.length ? (
            <div style={{ display: "flex", gap: 6, width: "100%" }}>
              {bar.map((part) => (
                <div
                  key={part.color}
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: part.color,
                    flexGrow: part.share,
                  }}
                />
              ))}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 24,
              paddingTop: 18,
              borderTop: `1px solid ${HAIRLINE}`,
            }}
          >
            <div style={{ display: "flex", gap: cover ? 26 : 40 }}>
              <Macro
                label="P"
                grams={macros.protein}
                color={MACRO_COLORS.protein}
              />
              <Macro
                label="C"
                grams={macros.carbs}
                color={MACRO_COLORS.carbs}
              />
              <Macro label="F" grams={macros.fat} color={MACRO_COLORS.fat} />
            </div>
            {cover ? null : (
              <span style={{ color: MUTED }}>macros.denizlg24.com</span>
            )}
          </div>
          {cover ? (
            <span style={{ fontSize: 22, color: MUTED }}>
              macros.denizlg24.com
            </span>
          ) : null}
        </div>
      </div>

      {cover ? (
        <img
          src={cover}
          width={500}
          height={630}
          style={{ objectFit: "cover" }}
          alt=""
        />
      ) : null}
    </div>,
    {
      ...size,
      fonts: [
        { name: "Source Serif", data: serifData, weight: 600, style: "normal" },
        { name: "Inter", data: sansData, weight: 500, style: "normal" },
      ],
    },
  );
}
