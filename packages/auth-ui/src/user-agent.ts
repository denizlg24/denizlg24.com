export interface UserAgentSummary {
  browser: string | null;
  platform: string | null;
  /** "Safari on iPhone", "Chrome", "Windows", or "Unknown device". */
  label: string;
}

// Order matters: most agents claim to be several browsers at once. Edge and
// Opera carry Chrome's token, Chrome carries Safari's, and the iOS builds of
// Chrome and Firefox carry Safari's without their desktop tokens.
const BROWSERS: [RegExp, string][] = [
  [/\bEdgA?\/|\bEdg\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bCriOS\//, "Chrome"],
  [/\bFxiOS\//, "Firefox"],
  [/\bFirefox\//, "Firefox"],
  [/(?:\b|Headless)Chrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

// iPad reports as a Mac in desktop mode; nothing in the string tells them
// apart, so it reads as a Mac and the passkey it holds is named the same way.
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

function first(table: [RegExp, string][], value: string): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(value)) return name;
  }
  return null;
}

export function describeUserAgent(
  userAgent: string | null | undefined,
): UserAgentSummary {
  const value = userAgent?.trim() ?? "";
  if (!value) return { browser: null, platform: null, label: "Unknown device" };
  const browser = first(BROWSERS, value);
  const platform = first(PLATFORMS, value);
  const label =
    browser && platform
      ? `${browser} on ${platform}`
      : (browser ?? platform ?? "Unknown device");
  return { browser, platform, label };
}
