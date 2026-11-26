export function BrandGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="8 12 48 40"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3.6}
      aria-hidden
    >
      <path d="M13 18C22 18 23 34 30 37" opacity={0.5} />
      <path d="M13 30C21 30 24 36 30 37" opacity={0.72} />
      <path d="M13 46C22 46 24 39 30 37" opacity={0.5} />
      <path d="M30 37L38 30L43 34L51 21" strokeWidth={5} />
      <circle cx={30} cy={37} r={3.6} fill="currentColor" stroke="none" />
      <circle cx={51} cy={21} r={3.6} fill="currentColor" stroke="none" />
    </svg>
  );
}
