import { cn } from "@repo/ui/utils";
import {
  ChartLine,
  LayoutGrid,
  type LucideIcon,
  Mic,
  Search,
  Sun,
  Utensils,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  demoClock,
  formatNumber,
  type MacroAmounts,
} from "@/app/_landing/demo-data";

export { IosFoodIcon } from "@/app/_landing/phone/food-icon";

type CssVars = Record<`--${string}`, string>;

export function withVars(
  values: CssVars,
  style?: CSSProperties,
): CSSProperties & CssVars {
  return { ...style, ...values };
}

export function delay(seconds: number): CSSProperties & CssVars {
  return withVars({ "--d": `${seconds}s` });
}

export const macroColor = {
  calories: "var(--macro-calories)",
  protein: "var(--macro-protein)",
  carbs: "var(--macro-carbs)",
  fat: "var(--macro-fat)",
  overflow: "var(--macro-overflow)",
} as const;

const MACROS = [
  { key: "protein", label: "Protein", letter: "P" },
  { key: "carbs", label: "Carbs", letter: "C" },
  { key: "fat", label: "Fat", letter: "F" },
] as const;

function SignalGlyph() {
  return (
    <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor">
      <rect x="0" y="8" width="3.2" height="4" rx="1" />
      <rect x="5.1" y="5.5" width="3.2" height="6.5" rx="1" />
      <rect x="10.2" y="3" width="3.2" height="9" rx="1" />
      <rect x="15.3" y="0" width="3.2" height="12" rx="1" />
    </svg>
  );
}

function WifiGlyph() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
      <path d="M8.5 2.4c2.4 0 4.6.9 6.3 2.5.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7A11.4 11.4 0 0 0 8.5 0 11.4 11.4 0 0 0 .3 3c-.2.2-.2.5 0 .7l1.2 1.2c.2.2.5.2.7 0A9 9 0 0 1 8.5 2.4Z" />
      <path d="M8.5 6.3c1.3 0 2.5.5 3.4 1.3.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7a7.4 7.4 0 0 0-10.6 0c-.2.2-.2.5 0 .7l1.2 1.2c.2.2.5.2.7 0 .9-.8 2.1-1.3 3.4-1.3Z" />
      <path d="M10.7 9.4c.2-.2.2-.5 0-.7a3.3 3.3 0 0 0-4.4 0c-.2.2-.2.5 0 .7l1.9 1.9c.2.2.5.2.6 0l1.9-1.9Z" />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="12"
        rx="3.8"
        stroke="currentColor"
        opacity="0.35"
      />
      <rect x="2" y="2" width="16" height="9" rx="2.4" fill="currentColor" />
      <path
        d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}

function IosStatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[60px] items-center justify-between px-[6px]">
      <span className="w-[130px] text-center text-[17px] font-semibold tracking-[-0.02em]">
        {demoClock}
      </span>
      <span className="flex w-[130px] items-center justify-center gap-[7px]">
        <SignalGlyph />
        <WifiGlyph />
        <BatteryGlyph />
      </span>
    </div>
  );
}

export function IosGlassButton({ children }: { children: ReactNode }) {
  return (
    <span className="ios-glass flex h-[44px] min-w-[44px] items-center justify-center gap-[20px] rounded-full px-[12px] text-ios-label">
      {children}
    </span>
  );
}

export function IosScreen({
  title,
  leading,
  trailing,
  children,
}: {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ios-bg">
      <IosStatusBar />
      <div className="absolute inset-x-[16px] top-[58px] z-20 flex h-[44px] items-center justify-between">
        {leading ?? <span />}
        {trailing}
      </div>
      <div className="px-[16px] pt-[106px]">
        <div className="ios-large-title tracking-[-0.01em]">{title}</div>
        <div className="mt-[6px] flex flex-col gap-[28px]">{children}</div>
      </div>
    </div>
  );
}

export function IosSection({
  title,
  action,
  footer,
  children,
}: {
  title?: string;
  action?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {title ? (
        <div className="mb-[8px] flex items-center gap-[8px]">
          <span className="ios-footnote ios-eyebrow text-ios-secondary">
            {title}
          </span>
          <span className="h-px flex-1 bg-ios-separator" />
          {action ? (
            <span className="ios-footnote font-semibold">{action}</span>
          ) : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="ios-footnote mt-[8px] text-ios-secondary">{footer}</div>
      ) : null}
    </div>
  );
}

export function IosHairline({ inset = 0 }: { inset?: number }) {
  return (
    <div className="h-px bg-ios-separator" style={{ marginLeft: inset }} />
  );
}

export function IosMeter({
  value,
  color,
  start = 0,
  height = 3,
}: {
  value: number;
  color: string;
  start?: number;
  height?: number;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      className="overflow-hidden rounded-full bg-ios-fill"
      style={{ height, borderRadius: height / 2 }}
    >
      <div
        className="a-grow-x h-full"
        style={withVars(
          { "--d": `${start}s` },
          {
            width: `${clamped * 100}%`,
            borderRadius: height / 2,
            backgroundColor: value > 1 ? macroColor.overflow : color,
          },
        )}
      />
    </div>
  );
}

const statValueClass = {
  hero: "ios-large-title",
  large: "ios-title2",
  regular: "ios-title3",
} as const;

export function IosStat({
  label,
  value,
  unit,
  detail,
  size = "regular",
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  size?: keyof typeof statValueClass;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[2px]", className)}>
      <span className="ios-caption1 ios-eyebrow truncate text-ios-secondary">
        {label}
      </span>
      <span className="flex items-baseline gap-[4px] whitespace-nowrap">
        <span className={cn(statValueClass[size], "font-figure")}>{value}</span>
        {unit ? (
          <span className="ios-footnote text-ios-secondary">{unit}</span>
        ) : null}
      </span>
      {detail ? (
        <span className="ios-footnote font-figure text-ios-secondary">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function IosMacroBars({
  consumed,
  targets,
  start = 0,
}: {
  consumed: MacroAmounts;
  targets: MacroAmounts;
  start?: number;
}) {
  return (
    <div className="flex gap-[16px]">
      {MACROS.map(({ key, label }, index) => (
        <div key={key} className="flex flex-1 flex-col gap-[4px]">
          <span className="ios-caption1 ios-eyebrow text-ios-secondary">
            {label}
          </span>
          <span className="flex items-baseline gap-[4px]">
            <span className="ios-headline font-figure">
              {formatNumber(consumed[key])}
            </span>
            <span className="ios-footnote font-figure text-ios-secondary">
              / {formatNumber(targets[key])} g
            </span>
          </span>
          <IosMeter
            value={consumed[key] / targets[key]}
            color={macroColor[key]}
            start={start + index * 0.12}
          />
        </div>
      ))}
    </div>
  );
}

export function IosMacroInline({ protein, carbs, fat }: MacroAmounts) {
  const grams = { protein, carbs, fat };
  return (
    <span className="flex gap-[12px]">
      {MACROS.map(({ key, letter }) => (
        <span key={key} className="ios-footnote font-figure text-ios-secondary">
          <span className="font-semibold" style={{ color: macroColor[key] }}>
            {letter}
          </span>{" "}
          {formatNumber(grams[key])}
        </span>
      ))}
    </span>
  );
}

export function IosCheckCircle({
  done,
  size = 24,
}: {
  done: boolean;
  size?: number;
}) {
  return done ? (
    <svg width={size} height={size} viewBox="0 0 24 24" className="flex-none">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="m7.2 12.4 3.1 3.1 6.5-6.7"
        fill="none"
        stroke="var(--ios-bg)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="flex-none text-ios-tertiary"
    >
      <circle
        cx="12"
        cy="12"
        r="10.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function IosCalorieRing({
  consumed,
  target,
  size = 168,
  stroke = 10,
  start = 0,
}: {
  consumed: number;
  target: number;
  size?: number;
  stroke?: number;
  start?: number;
}) {
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const progress = Math.min(1, consumed / target);
  const remaining = target - consumed;
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--ios-fill)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={macroColor.calories}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          strokeDashoffset={100 - progress * 100}
          className="a-ring"
          style={delay(start)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="ios-large-title font-figure">
          {formatNumber(Math.abs(remaining))}
        </span>
        <span className="ios-footnote text-ios-secondary">
          {remaining >= 0 ? "kcal left" : "kcal over"}
        </span>
      </div>
    </div>
  );
}

export function IosDayRing({
  day,
  progress,
  selected,
  today,
  disabled,
  start = 0,
}: {
  day: number;
  progress: number;
  selected: boolean;
  today: boolean;
  disabled: boolean;
  start?: number;
}) {
  const size = 38;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <span
      className="relative block"
      style={{ width: size, height: size, opacity: disabled ? 0.3 : 1 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        {selected ? (
          <circle
            cx={center}
            cy={center}
            r={radius - stroke - 1}
            fill="var(--ios-label)"
          />
        ) : null}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--ios-fill)"
          strokeWidth={stroke}
        />
        {filled > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={progress > 1 ? macroColor.overflow : macroColor.calories}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - filled * 100}
            className="a-ring"
            style={delay(start)}
          />
        ) : null}
      </svg>
      <span
        className={cn(
          "ios-footnote font-figure absolute inset-0 flex items-center justify-center",
          selected || today ? "font-bold" : "font-medium",
          selected && "text-ios-bg",
        )}
      >
        {day}
      </span>
    </span>
  );
}

export function IosSegmented({
  options,
  value,
}: {
  options: readonly string[];
  value: string;
}) {
  return (
    <div className="flex h-[34px] rounded-full bg-ios-tertiary-fill p-[3px]">
      {options.map((option) => (
        <span
          key={option}
          className={cn(
            "flex flex-1 items-center justify-center rounded-full text-[13px] font-medium",
            option === value &&
              "bg-[var(--ios-segment)] font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]",
          )}
        >
          {option}
        </span>
      ))}
    </div>
  );
}

export type IosTab = "today" | "log" | "progress" | "more";

const TABS: ReadonlyArray<{ id: IosTab; label: string; icon: LucideIcon }> = [
  { id: "today", label: "Today", icon: Sun },
  { id: "log", label: "Log", icon: Utensils },
  { id: "progress", label: "Progress", icon: ChartLine },
  { id: "more", label: "More", icon: LayoutGrid },
];

export function IosTabBar({ active }: { active: IosTab }) {
  const index = TABS.findIndex((tab) => tab.id === active);
  return (
    <>
      <IosBottomEdge />
      <div className="absolute inset-x-[20px] bottom-[28px] z-20 flex items-center gap-[10px]">
        <div className="ios-glass relative flex h-[62px] flex-1 items-center rounded-full p-[4px]">
          <span
            className="ios-tab-lens absolute inset-y-[4px] left-[4px] w-[calc((100%-8px)/4)] rounded-full bg-ios-tertiary-fill"
            style={{ translate: `${index * 100}% 0` }}
          />
          {TABS.map(({ id, label, icon: Icon }) => (
            <span
              key={id}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-[3px] transition-opacity duration-300",
                id !== active && "opacity-80",
              )}
            >
              <Icon size={22} strokeWidth={id === active ? 2.4 : 1.8} />
              <span
                className={cn(
                  "text-[10px] leading-none",
                  id === active ? "font-semibold" : "font-medium",
                )}
              >
                {label}
              </span>
            </span>
          ))}
        </div>
        <span className="ios-glass flex size-[62px] flex-none items-center justify-center rounded-full">
          <Search size={23} strokeWidth={2} />
        </span>
      </div>
      <IosHomeIndicator />
    </>
  );
}

export function IosSearchBar({ placeholder }: { placeholder: string }) {
  return (
    <>
      <IosBottomEdge />
      <div className="absolute inset-x-[20px] bottom-[28px] z-20 flex items-center gap-[10px]">
        <span className="ios-glass flex size-[52px] flex-none items-center justify-center rounded-full">
          <Sun size={21} strokeWidth={1.9} />
        </span>
        <span className="ios-glass flex h-[52px] flex-1 items-center gap-[8px] rounded-full px-[16px] text-ios-secondary">
          <Search size={19} strokeWidth={2.2} />
          <span className="ios-body flex-1">{placeholder}</span>
          <Mic size={19} strokeWidth={2} />
        </span>
      </div>
      <IosHomeIndicator />
    </>
  );
}

function IosBottomEdge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[140px] bg-linear-to-t from-ios-bg from-15% via-ios-bg/70 to-transparent" />
  );
}

function IosHomeIndicator() {
  return (
    <span className="absolute bottom-[8px] left-1/2 z-30 h-[5px] w-[140px] -translate-x-1/2 rounded-full bg-ios-label" />
  );
}
