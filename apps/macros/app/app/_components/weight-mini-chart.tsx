import type { WeightPoint } from "@/lib/weights/contracts"

export function WeightMiniChart({
  points,
  className = "",
}: {
  points: WeightPoint[]
  className?: string
}) {
  if (points.length < 2) {
    return (
      <div
        className={`flex h-14 items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground ${className}`}
      >
        No trend yet
      </div>
    )
  }

  const values = points.map((point) => point.weightKg)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.5)
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100
    const y = 52 - ((point.weightKg - min) / range) * 42
    return { x, y }
  })
  const path = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`)
    .join(" ")

  return (
    <svg
      viewBox="0 0 100 60"
      className={`h-14 w-full overflow-visible ${className}`}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="54"
        x2="100"
        y2="54"
        className="stroke-border"
        strokeWidth="1"
      />
      <path
        d={path}
        fill="none"
        className="stroke-primary"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      {coords.map((coord, index) => (
        <circle
          key={`${points[index].date}-${points[index].weightKg}`}
          cx={coord.x}
          cy={coord.y}
          r="4"
          className="fill-background stroke-primary"
          strokeWidth="3"
        />
      ))}
    </svg>
  )
}
