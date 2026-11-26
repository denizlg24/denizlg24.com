/** The Stockwatcher mark: a W drawn as one price line, closing on the last print. */
export function BrandGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="4 10 56 44"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 21L18.5 45L31 27L43.5 45L52 21" strokeWidth={7} />
      <circle cx={52} cy={21} r={5.2} fill="currentColor" stroke="none" />
    </svg>
  );
}
