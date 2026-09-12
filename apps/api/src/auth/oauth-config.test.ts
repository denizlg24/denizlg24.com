import { describe, expect, test } from "bun:test";
import { oauthConfigFromEnv } from "./oauth-config";

describe("oauthConfigFromEnv", () => {
  test("the public API URL selects the production identities", () => {
    expect(oauthConfigFromEnv("https://api.denizlg24.com", {})).toEqual({
      authAppUrl: "https://auth.denizlg24.com",
      resources: {
        api: "https://api.denizlg24.com",
        web: "https://denizlg24.com",
        mcp: "https://mcp.denizlg24.com/mcp",
      },
    });
  });

  test("a loopback API URL selects the dev ports", () => {
    expect(oauthConfigFromEnv("http://localhost:3001", {})).toEqual({
      authAppUrl: "http://localhost:3008",
      resources: {
        api: "http://localhost:3001",
        web: "http://localhost:3000",
        mcp: "http://localhost:3009/mcp",
      },
    });
  });

  test("explicit overrides win over either default", () => {
    const config = oauthConfigFromEnv("https://api.denizlg24.com", {
      AUTH_APP_URL: "https://auth.example.test",
      OAUTH_RESOURCE_WEB: "https://www.example.test",
    });
    expect(config.authAppUrl).toBe("https://auth.example.test");
    expect(config.resources.web).toBe("https://www.example.test");
    expect(config.resources.api).toBe("https://api.denizlg24.com");
  });
});
