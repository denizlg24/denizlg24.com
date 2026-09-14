import type { SVGProps } from "react";

/**
 * The three line drawings the app has: an empty folder, a search with nothing
 * in it, and a cloud that cannot be reached. Inline SVG in `currentColor`, so
 * they take the muted foreground of either theme and need no asset.
 */
function Frame(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 96 96"
      width={96}
      height={96}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function EmptyFolderIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <Frame {...props}>
      <path d="M14 30a4 4 0 0 1 4-4h16l6 6h34a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" />
      <path d="M14 40h64" />
      <path d="M48 50v14M41 57h14" strokeDasharray="2 3" />
      <path d="M26 14c3 0 3-4 6-4s3 4 6 4 3-4 6-4" opacity={0.5} />
    </Frame>
  );
}

export function NothingFoundIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <Frame {...props}>
      <circle cx="42" cy="42" r="22" />
      <path d="M58 58l20 20" />
      <path d="M34 42c2-3 5-4 8-4s6 1 8 4" opacity={0.5} />
      <path d="M36 34h.5M48 34h.5" strokeWidth={2.5} />
    </Frame>
  );
}

export function UnreachableIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <Frame {...props}>
      <path d="M30 66h38a12 12 0 0 0 2-23.8A18 18 0 0 0 36 38a13 13 0 0 0-6 28z" />
      <path d="M22 78l52-52" opacity={0.6} />
      <path
        d="M44 76l-4 8M52 76l-2 8M60 76l0 8"
        strokeDasharray="2 3"
        opacity={0.5}
      />
    </Frame>
  );
}
