export function Sparkline({
  points,
  width = 132,
  height = 30,
  label,
}: {
  points: readonly { t: number; c: number }[];
  width?: number;
  height?: number;
  label: string;
}) {
  if (points.length < 2) return null;
  const closes = points.map((point) => point.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (index: number) =>
    (index / (points.length - 1)) * (width - pad * 2) + pad;
  const y = (value: number) =>
    height - pad - ((value - min) / span) * (height - pad * 2);
  const line = closes
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
    )
    .join(" ");
  const rising = closes.at(-1)! >= closes[0];
  return (
    <svg
      className={`chat-spark ${rising ? "positive" : "negative"}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <line
        x1={pad}
        x2={width - pad}
        y1={y(closes[0])}
        y2={y(closes[0])}
        className="chat-spark-base"
      />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(closes.length - 1)}
        cy={y(closes.at(-1)!)}
        r="1.75"
        fill="currentColor"
      />
    </svg>
  );
}
