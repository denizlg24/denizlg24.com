import { describe, expect, it } from "bun:test";

import {
  authorizePreviewRequest,
  PREVIEW_AUTH_SEEN_COOKIE,
  PREVIEW_SHARE_COOKIE,
  type PreviewAuthorizationOptions,
} from "./preview-auth";
import { generatePreviewShareToken } from "./preview-share";

const ID = "97a12bc5-daf5-4764-97ee-04c7829fce3d";
const OTHER_ID = "f2040261-fd7b-44eb-836a-d1d00837b021";
const HOST = "my-app-feature-abc123.denizlg24.com";
const SECRET = "preview-auth-test-secret-at-least-32-bytes";
const NOW = 10_000;

function options(
  input: {
    kind?: "production" | "preview";
    session?: unknown;
    account?: unknown;
  } = {},
): PreviewAuthorizationOptions {
  let grant:
    | { deploymentId: string; expiresAt: Date | null; revokedAt: null }
    | undefined;
  return {
    auth: {
      api: { getSession: async () => input.session ?? null },
    },
    db: {
      query: {
        deployments: {
          findFirst: async () => ({ id: ID, kind: input.kind ?? "preview" }),
        },
        previewShareGrants: { findFirst: async () => grant },
        users: { findFirst: async () => input.account ?? null },
      },
      insert: () => ({
        values: async (value: {
          deploymentId: string;
          expiresAt: Date | null;
        }) => {
          grant = { ...value, revokedAt: null };
        },
      }),
    },
    loginUrl: "https://forge.denizlg24.com/login",
    secret: SECRET,
    now: () => NOW,
  } as unknown as PreviewAuthorizationOptions;
}

function request(uri: string, cookie?: string): Request {
  return new Request("https://api.denizlg24.com/api/forge-preview-auth", {
    headers: {
      "x-forwarded-host": HOST,
      "x-forwarded-uri": uri,
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("preview forward auth", () => {
  it("exchanges a scoped token for a host-only cookie and clean URL", async () => {
    const authOptions = options();
    const token = await generatePreviewShareToken(
      authOptions.db,
      ID,
      "7d",
      SECRET,
      NOW,
    );
    const response = await authorizePreviewRequest(
      request(`/docs?keep=1&__forge_share=${token}`),
      authOptions,
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Authenticating");
    expect(response.headers.get("set-cookie")).toContain(
      `${PREVIEW_SHARE_COOKIE}=${token}`,
    );
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure");
  });

  it("accepts the exchanged share cookie on later paths", async () => {
    const authOptions = options();
    const token = await generatePreviewShareToken(
      authOptions.db,
      ID,
      "7d",
      SECRET,
      NOW,
    );
    const response = await authorizePreviewRequest(
      request("/assets/app.js", `${PREVIEW_SHARE_COOKIE}=${token}`),
      authOptions,
    );
    expect(response.status).toBe(204);
  });

  it("rejects a token minted for a different deployment", async () => {
    const authOptions = options();
    const token = await generatePreviewShareToken(
      authOptions.db,
      OTHER_ID,
      "7d",
      SECRET,
      NOW,
    );
    const response = await authorizePreviewRequest(
      request(`/?__forge_share=${token}`),
      authOptions,
    );
    expect(response.status).toBe(403);
  });

  it("returns unauthenticated visitors to the exact preview URL after login", async () => {
    const response = await authorizePreviewRequest(
      request("/docs?tab=api", `${PREVIEW_AUTH_SEEN_COOKIE}=1`),
      options(),
    );
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).toContain("Authentication required.");
    expect(body).toContain("https://forge.denizlg24.com/login");
    expect(body).toContain(
      encodeURIComponent(`https://${HOST}/docs?tab=api`).replaceAll("%", "%"),
    );
  });

  it("shows a one-time authentication splash before checking a session", async () => {
    const response = await authorizePreviewRequest(request("/"), options());
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain(
      `${PREVIEW_AUTH_SEEN_COOKIE}=1`,
    );
    expect(await response.text()).toContain("Checking preview access…");
  });

  it("accepts only a current, MFA-enabled superuser session", async () => {
    const activeSession = {
      session: { expiresAt: new Date(NOW + 1_000) },
      user: {
        id: "user-1",
        status: "active",
        twoFactorEnabled: true,
      },
    };
    const account = {
      role: "superuser",
      status: "active",
      totpEnabled: true,
    };
    const cookie = `${PREVIEW_AUTH_SEEN_COOKIE}=1`;

    expect(
      (
        await authorizePreviewRequest(
          request("/", cookie),
          options({ session: activeSession, account }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await authorizePreviewRequest(
          request("/", cookie),
          options({
            session: activeSession,
            account: { ...account, role: "user" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await authorizePreviewRequest(
          request("/", cookie),
          options({
            session: {
              ...activeSession,
              session: { expiresAt: new Date(NOW - 1) },
            },
            account,
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("lets production through when upgrading legacy Caddy state", async () => {
    const response = await authorizePreviewRequest(
      request("/"),
      options({
        kind: "production",
      }),
    );
    expect(response.status).toBe(204);
  });

  it("refuses a forwarded URI that resolves to another host", async () => {
    const response = await authorizePreviewRequest(
      request("/\\evil.example/path"),
      options(),
    );
    expect(response.status).toBe(400);
  });
});
