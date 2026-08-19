import { MACRO_COLORS } from "@/lib/macro-colors"

type Props = {
  consumed: number
  target: number | null
  view: "consumed" | "remaining"
  primaryValue: number
  primaryLabel: string
}

export function CalorieRing({
  consumed,
  target,
  view,
  primaryValue,
  primaryLabel,
}: Props) {
  const r = 70
  const cx = 90
  const cy = 90
  const strokeWidth = 16
  const circ = 2 * Math.PI * r
  const arcLength = (270 / 360) * circ
  const rotation = 135

  const remaining = target != null ? Math.max(0, target - consumed) : 0
  const fillValue = view === "consumed" ? consumed : remaining

  const fillRatio =
    target != null && target > 0 ? Math.min(fillValue / target, 1) : 0
  const fillLength = fillRatio * arcLength

  return (
    <svg viewBox="0 0 180 180" className="w-full" aria-hidden="true">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        className="stroke-muted"
        strokeWidth={strokeWidth}
        strokeDasharray={`${arcLength} ${circ - arcLength}`}
        strokeLinecap="round"
        transform={`rotate(${rotation}, ${cx}, ${cy})`}
      />
      {fillLength > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={MACRO_COLORS.calories}
          strokeWidth={strokeWidth}
          strokeDasharray={`${fillLength} ${circ - fillLength}`}
          strokeLinecap="round"
          transform={`rotate(${rotation}, ${cx}, ${cy})`}
        />
      )}
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="30"
        fontWeight="900"
        className="fill-foreground"
      >
        {Math.round(primaryValue)}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="13"
        className="fill-muted-foreground"
      >
        {primaryLabel}
      </text>
    </svg>
  )
}
