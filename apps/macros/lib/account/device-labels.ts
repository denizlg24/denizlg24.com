const BROWSERS = [
  ["Edge", /\bEdg(?:e|A|iOS)?\//],
  ["Opera", /\bOPR\//],
  ["Samsung Internet", /\bSamsungBrowser\//],
  ["Firefox", /\b(?:Firefox|FxiOS)\//],
  ["Chrome", /\b(?:Chrome|CriOS)\//],
  ["Safari", /\bVersion\/[\d.]+.*\bSafari\//],
] as const;

const PLATFORMS = [
  ["iPhone", /\biPhone\b/],
  ["iPad", /\biPad\b/],
  ["Android", /\bAndroid\b/],
  ["Mac", /\bMacintosh\b/],
  ["Windows", /\bWindows\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Linux", /\bLinux\b/],
] as const;

/** A person-readable name for the device a session was signed in from. */
export function describeUserAgent(userAgent: string | null) {
  if (!userAgent) return "Unknown device";

  // Native requests carry the system networking stack's agent rather than a
  // browser's: CFNetwork on iOS, OkHttp on Android.
  if (!userAgent.startsWith("Mozilla/")) {
    if (/\bCFNetwork\//.test(userAgent)) return "Macros for iPhone";
    if (/^okhttp\//i.test(userAgent)) return "Macros for Android";
  }

  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const platform = PLATFORMS.find(([, pattern]) =>
    pattern.test(userAgent),
  )?.[0];

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "Unknown device";
}

const DAY_MS = 86_400_000;
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** In whole days only: Better Auth refreshes a session at most once a day. */
export function describeLastActive(at: Date, now: Date) {
  const days = Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS));
  if (days < 30) {
    return `Active ${relative.format(days === 0 ? 0 : -days, "day")}`;
  }
  return `Active ${relative.format(-Math.floor(days / 30), "month")}`;
}
