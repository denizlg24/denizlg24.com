import { afterEach, describe, expect, it } from "bun:test";

import { terminalServiceConfigFromEnv } from "./config";

const SECRET = "x".repeat(32);
const originalHost = process.env.HOST;

afterEach(() => {
  if (originalHost === undefined) delete process.env.HOST;
  else process.env.HOST = originalHost;
});

function configWithHost(host: string | undefined) {
  if (host === undefined) delete process.env.HOST;
  else process.env.HOST = host;
  process.env.TERMINAL_TICKET_SECRET = SECRET;
  return terminalServiceConfigFromEnv();
}

describe("terminal bind address", () => {
  it("defaults to loopback", () => {
    expect(configWithHost(undefined).host).toBe("127.0.0.1");
  });

  it("accepts loopback explicitly", () => {
    expect(configWithHost("127.0.0.1").host).toBe("127.0.0.1");
    expect(configWithHost("::1").host).toBe("::1");
  });

  // A loopback listener is unreachable from the API container, so the Tailscale
  // (CGNAT) address has to be bindable or the web terminal cannot work at all.
  it("accepts the CGNAT range Tailscale assigns", () => {
    expect(configWithHost("100.89.155.9").host).toBe("100.89.155.9");
  });

  it("accepts private ranges", () => {
    expect(configWithHost("10.1.2.3").host).toBe("10.1.2.3");
    expect(configWithHost("172.17.0.1").host).toBe("172.17.0.1");
    expect(configWithHost("192.168.1.245").host).toBe("192.168.1.245");
  });

  it("still refuses wildcards", () => {
    expect(() => configWithHost("0.0.0.0")).toThrow(/wildcard/);
    expect(() => configWithHost("::")).toThrow(/wildcard/);
  });

  it("still refuses publicly routable addresses", () => {
    expect(() => configWithHost("8.8.8.8")).toThrow(/loopback, private/);
    expect(() => configWithHost("172.32.0.1")).toThrow(/loopback, private/);
    expect(() => configWithHost("100.128.0.1")).toThrow(/loopback, private/);
  });
});
