"use client"

import { format, isAfter } from "date-fns"
import Link from "next/link"
import { MACRO_COLORS } from "@/lib/macro-colors"

interface CalorieDayPillProps {
  date: Date
  iso: string
  consumed: number
  target: number | null
  strokeColor?: string
  href?: string
  ariaLabel?: string
  isDimmed?: boolean
  isDisabled?: boolean
  isPartial?: boolean
  showWeekday?: boolean
  className?: string
}

export function CalorieDayPill({
  ariaLabel,
  className = "",
  consumed,
  date,
  href,
  isDimmed = false,
  isDisabled = false,
  isPartial = false,
  iso,
  showWeekday = true,
  strokeColor = MACRO_COLORS.calories,
  target,
}: CalorieDayPillProps) {
  const width = showWeekday ? 44 : 38
  const height = showWeekday ? 56 : 38
  const strokeWidth = 2.5
  const padding = strokeWidth / 2 + 0.5
  const rectWidth = width - strokeWidth
  const rectHeight = height - strokeWidth
  const radius = Math.min(rectWidth, rectHeight) / 2
  const perimeter =
    rectWidth >= rectHeight
      ? 2 * (rectWidth - rectHeight) + Math.PI * rectHeight
      : 2 * (rectHeight - rectWidth) + Math.PI * rectWidth
  const startOffset = rectWidth / 2 - radius
  const fillRatio = target != null && target > 0 ? consumed / target : 0
  const fillLength = Math.min(fillRatio, 1) * perimeter
  const disabled = isDisabled || isAfter(date, new Date())

  const content = (
    <div
      className={`relative mx-auto flex flex-col items-center justify-center text-[10px] leading-tight transition-opacity ${
        disabled || isDimmed ? "opacity-35" : ""
      } ${className}`}
      style={{ width, height }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="absolute inset-0"
        aria-hidden="true"
      >
        <rect
          x={padding}
          y={padding}
          width={rectWidth}
          height={rectHeight}
          rx={radius}
          fill="none"
          className="stroke-border"
          strokeWidth={strokeWidth}
        />
        {fillLength > 0 ? (
          <rect
            x={padding}
            y={padding}
            width={rectWidth}
            height={rectHeight}
            rx={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={isPartial ? "4 4" : `${fillLength} ${perimeter}`}
            strokeDashoffset={isPartial ? 0 : -startOffset}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      {showWeekday ? (
        <span className="relative font-medium text-muted-foreground">
          {format(date, "EEEEE")}
        </span>
      ) : null}
      <span className="relative text-sm font-semibold tabular-nums">
        {format(date, "d")}
      </span>
    </div>
  )

  if (disabled || !href) {
    return (
      <div aria-disabled={disabled ? "true" : undefined} data-date={iso}>
        {content}
      </div>
    )
  }

  return (
    <Link href={href} aria-label={ariaLabel ?? format(date, "PPPP")}>
      {content}
    </Link>
  )
}
