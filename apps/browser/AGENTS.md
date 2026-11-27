# apps/browser — the agent's browser

`@playwright/mcp`'s tools (snapshot, click, type, screenshot, coordinate
clicks, PDF) served over streamable HTTP from one Google Chrome, added to
the agent as an ordinary `bearer` connector (`BROWSER_MCP_TOKEN`, URL
`https://browser.denizlg24.com/mcp`). Its Dockerfile is Debian, not alpine:
Chrome is a glibc build and `playwright install --with-deps` only knows apt.

- **Chrome runs headful on Xvfb, never headless.** Playwright's headless
  builds put `HeadlessChrome` in the UA and client hints and report no
  pointer; every challenge vendor stops them on sight. The pool owns the
  launch, so anything @playwright/mcp would add to *its* launch options
  (it disables `AutomationControlled`) never applies — the pool's own
  `launch` must carry it, and `--enable-automation` is dropped there too.
  Timezone (`BROWSER_TIMEZONE`, baked into the image) must match where
  Forge's egress IP geolocates; locale and screen are config too. The one
  known tell left is WebGL reporting SwiftShader. Chrome ships no
  linux/arm64, so the image is amd64 only.

- **A browser context lives per agent session, not per MCP session.** Web
  closes every connector client at the end of a turn, and Playwright MCP's
  server cannot be re-initialised on an old `Mcp-Session-Id`, so
  `apps/web/lib/connectors/service.ts` sends `x-agent-session` (a hash of
  the conversation id, or the task run id) on every connector request and
  `apps/browser/src/mcp-sessions.ts` keys its `BrowserPool` on it: a fresh
  Playwright server per turn adopts the tabs the previous one left. A
  request without the header gets a context that is closed with the session.
  Contexts are reaped after `BROWSER_SESSION_IDLE_MINUTES` (30) or evicted
  LRU past `BROWSER_MAX_SESSIONS` (4); nothing persists across a restart, so
  logins do not survive one.
- **Egress goes through `src/egress-proxy.ts`, which is the SSRF boundary.**
  The container has real network access — unlike the code sandbox — and sits
  on the tailnet, so Chromium is launched with the in-container proxy and
  `<-loopback>` in the bypass list; the proxy resolves every name itself and
  refuses loopback, RFC 1918, link-local, CGNAT (`100.64/10`, Tailscale) and
  the rest of `src/private-address.ts` on the *resolved* address, so a
  rebinding answer is refused rather than connected to. `BROWSER_ALLOW_PRIVATE_EGRESS=1`
  is for local dev only. Playwright MCP's own `network.blockedOrigins` is a
  URL filter and would not have caught any of this.
- **Screenshots leave the message on arrival.** `offloadConnectorImages` in
  `apps/web/lib/connectors/toolset.ts` uploads every image a connector
  returns to the `image` bucket and stores `{ type: "image", url }` in the
  UI message; `withBoundedToolImages` in `lib/agent/model-messages.ts` then
  hands the model only the newest `MAX_INLINE_TOOL_IMAGES` (3) as pixels and
  a one-line reference for the rest. Without both, a 30-screenshot session
  re-sends ~36k image tokens on every step. A store failure keeps the bytes
  inline; `packages/admin/src/agent/agent-parts.ts` renders either shape.
- **The AI SDK's first `initialize` is a 400 by design.** It opens with
  protocol `2026-07-28`, which SDK 1.x refuses, then retries with
  `2025-11-25`; `McpSessions.open` only registers a session once the
  transport accepted the initialize, otherwise every turn leaked a server.
  The client's standalone `GET` stream answers 409 and it stops asking; tool
  calls are unary and unaffected.
- **Approval is the connector policy, nothing browser-specific.** Playwright
  marks snapshot/screenshot read-only and everything else a write, so under
  `reads-auto` every click asks; a browsing task wants `never-ask` (or
  YOLO). Anything the agent reads on a page can instruct it — keep that in
  mind before handing it an authenticated profile, which today does not
  exist.
- **Two pins must stay equal.** `playwright` in `apps/browser/package.json`
  must be the exact alpha `@playwright/mcp` depends on, or two Playwright
  copies are installed and the context the pool hands the MCP server is not
  one it recognises. The Dockerfile's runtime stage installs only those two
  packages (the rest is bundled) and `playwright install chromium` fetches
  the revision that build names.
