export interface BrowserConfig {
  port: number;
  /** The bearer the agent's connector presents. */
  token: string;
  proxyPort: number;
  /** Dev only: lets the browser reach loopback and the LAN. */
  allowPrivateEgress: boolean;
  viewport: { width: number; height: number };
  /** What `window.screen` reports; matches the Xvfb display in the image. */
  screen: { width: number; height: number };
  /** Off in production: Chrome runs headful on Xvfb, the headless builds announce themselves. */
  headless: boolean;
  /** Playwright channel; `chrome` is the Google Chrome stable build installed in the image. */
  channel?: string;
  locale: string;
  /** Unset leaves the container's zone; set it to where the egress IP geolocates. */
  timezoneId?: string;
  maxSessions: number;
  sessionIdleMs: number;
  mcpIdleMs: number;
  outputDir: string;
  executablePath?: string;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function dimensions(
  value: string | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const match = value?.match(/^(\d{3,4})x(\d{3,4})$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : fallback;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrowserConfig {
  const token = env.BROWSER_MCP_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new Error("BROWSER_MCP_TOKEN must be set to at least 32 characters");
  }
  return {
    port: integer(env.PORT, 3010),
    token,
    proxyPort: integer(env.BROWSER_PROXY_PORT, 3128),
    allowPrivateEgress: env.BROWSER_ALLOW_PRIVATE_EGRESS === "1",
    viewport: dimensions(env.BROWSER_VIEWPORT, { width: 1280, height: 720 }),
    screen: dimensions(env.BROWSER_SCREEN, { width: 1920, height: 1080 }),
    headless: env.BROWSER_HEADLESS === "1",
    ...(env.BROWSER_CHANNEL !== "" ? { channel: env.BROWSER_CHANNEL ?? "chrome" } : {}),
    locale: env.BROWSER_LOCALE?.trim() || "en-US",
    ...(env.BROWSER_TIMEZONE?.trim()
      ? { timezoneId: env.BROWSER_TIMEZONE.trim() }
      : {}),
    maxSessions: integer(env.BROWSER_MAX_SESSIONS, 4),
    sessionIdleMs: integer(env.BROWSER_SESSION_IDLE_MINUTES, 30) * 60_000,
    mcpIdleMs: integer(env.BROWSER_MCP_IDLE_MINUTES, 60) * 60_000,
    outputDir: env.BROWSER_OUTPUT_DIR ?? "/tmp/browser-output",
    ...(env.BROWSER_EXECUTABLE_PATH
      ? { executablePath: env.BROWSER_EXECUTABLE_PATH }
      : {}),
  };
}
