import { cn } from "@repo/ui/utils";
import { labelScan } from "@/app/_landing/demo-data";
import { InView } from "@/app/_landing/in-view";
import { delay, macroColor } from "@/app/_landing/phone/ios";

const L_CODES = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const LEFT_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

const invert = (bits: string) =>
  [...bits].map((bit) => (bit === "1" ? "0" : "1")).join("");

/** EAN-13 as 95 modules; the first digit is carried by the left half's parity. */
function ean13(code: string) {
  const [first = 0, ...digits] = [...code].map(Number);
  const parity = LEFT_PARITY[first] ?? LEFT_PARITY[0];
  const left = digits.slice(0, 6).map((digit, index) => {
    const odd = L_CODES[digit] ?? "";
    return parity?.[index] === "G" ? [...invert(odd)].reverse().join("") : odd;
  });
  const right = digits.slice(6).map((digit) => invert(L_CODES[digit] ?? ""));
  return `101${left.join("")}01010${right.join("")}101`;
}

const GUARDS = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);

/** Two pixels a module keeps every bar on the pixel grid. */
function Barcode({ code }: { code: string }) {
  const modules = ean13(code);
  return (
    <div className="flex items-end gap-1.5 font-mono text-[10px] leading-none tracking-[0.2em] text-muted-foreground">
      <span className="pb-px">{code.slice(0, 1)}</span>
      <div className="flex flex-col">
        <svg
          viewBox="0 0 95 46"
          width={190}
          height={46}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          className="text-foreground"
        >
          {[...modules].map((bit, index) =>
            bit === "1" ? (
              <rect
                key={index}
                x={index}
                y={0}
                width={1}
                height={GUARDS.has(index) ? 46 : 40}
                fill="currentColor"
              />
            ) : null,
          )}
        </svg>
        <span className="-mt-1 grid grid-cols-2 px-1.5 text-center">
          <span>{code.slice(1, 7)}</span>
          <span>{code.slice(7)}</span>
        </span>
      </div>
    </div>
  );
}

const SCAN_START = 0.5;
const SCAN_SECONDS = 1.6;

const READ_OUT = [
  { key: "calories", label: "kcal", value: labelScan.read.calories },
  { key: "protein", label: "Protein", value: labelScan.read.protein },
  { key: "carbs", label: "Carbs", value: labelScan.read.carbs },
  { key: "fat", label: "Fat", value: labelScan.read.fat },
] as const;

export function LabelScanFigure() {
  const rowCount = labelScan.rows.length;
  return (
    <InView className="w-full max-w-[25rem]" threshold={0.4}>
      <figure>
        <div aria-hidden="true">
          <div className="flex items-end justify-between gap-6">
            <Barcode code={labelScan.barcode} />
            <span className="eyebrow pb-5 text-right tracking-[0.08em]">
              {labelScan.product}
            </span>
          </div>

          <div className="relative mt-6 overflow-hidden rounded-[6px] border-2 border-foreground px-4 pt-3 pb-2">
            <div className="flex items-baseline justify-between border-b-[6px] border-foreground pb-2">
              <span className="text-xl font-extrabold tracking-tight">
                Nutrition
              </span>
              <span className="text-xs font-semibold">{labelScan.per}</span>
            </div>
            <dl className="text-[13px] leading-snug">
              {labelScan.rows.map((row, index) => {
                const macro = "macro" in row ? row.macro : undefined;
                const sub = "sub" in row && row.sub;
                return (
                  <div
                    key={row.label}
                    className={cn(
                      "relative -mx-4 flex justify-between gap-4 border-b border-foreground/25 px-4 py-[7px] last:border-b-0",
                      macro && "a-mark",
                    )}
                    style={delay(
                      SCAN_START + ((index + 0.5) / rowCount) * SCAN_SECONDS,
                    )}
                  >
                    {macro ? (
                      <span
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full"
                        style={{ backgroundColor: macroColor[macro] }}
                      />
                    ) : null}
                    <dt className={cn(sub ? "pl-3" : "font-semibold")}>
                      {row.label}
                    </dt>
                    <dd className={cn("font-figure", !sub && "font-semibold")}>
                      {row.value}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div
              className="scan-line a-scan pointer-events-none absolute inset-0"
              style={delay(SCAN_START)}
            >
              <span className="absolute inset-x-0 top-0 h-0.5 bg-macro-calories shadow-[0_0_18px_4px_var(--macro-calories)]" />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <span className="eyebrow">Read from the photo</span>
            <div className="grid grid-cols-4 gap-3 border-t pt-4">
              {READ_OUT.map((item, index) => (
                <span
                  key={item.key}
                  className="a-rise flex flex-col gap-1.5"
                  style={delay(SCAN_START + SCAN_SECONDS + index * 0.08)}
                >
                  <span
                    className="h-[3px] w-5 rounded-full"
                    style={{ backgroundColor: macroColor[item.key] }}
                  />
                  <span className="font-figure text-2xl leading-none font-semibold">
                    {item.value}
                    {item.key === "calories" ? null : (
                      <span className="ml-0.5 text-sm font-medium text-muted-foreground">
                        g
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <figcaption className="sr-only">
          A barcode and the nutrition label of a packet of rolled oats. Macros
          reads 382 kcal, 13 g protein, 60 g carbohydrate and 8 g fat per 100 g
          from a photo of the label.
        </figcaption>
      </figure>
    </InView>
  );
}
