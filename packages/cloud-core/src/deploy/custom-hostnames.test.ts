import { describe, expect, it } from "bun:test";

import type { CloudflareDeployConfig } from "./cloudflare-dns";
import {
  CloudflareCustomHostnameClient,
  readCustomHostnameStatus,
} from "./custom-hostnames";
import { defaultDomainMode, isZoneHostname } from "./domains";

const CONFIG: CloudflareDeployConfig = {
  apiToken: "token",
  zoneId: "zone",
  zoneName: "denizlg24.com",
  tunnelId: "tunnel",
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function client(handler: () => Response) {
  const calls: Call[] = [];
  const implementation = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return handler();
    },
    { preconnect: () => {} },
  );
  return {
    calls,
    instance: new CloudflareCustomHostnameClient({
      config: CONFIG,
      fetchImplementation: implementation,
    }),
  };
}

function envelope(result: unknown, success = true): Response {
  return new Response(JSON.stringify({ success, result, errors: [] }), {
    headers: { "content-type": "application/json" },
  });
}

describe("readCustomHostnameStatus", () => {
  it("is only active when the hostname and its certificate both are", () => {
    expect(
      readCustomHostnameStatus({
        status: "active",
        ssl: { status: "pending_validation" },
      }).status,
    ).toBe("verifying");
    expect(
      readCustomHostnameStatus({ status: "active", ssl: { status: "active" } })
        .status,
    ).toBe("active");
  });

  it("surfaces the DV records the owner has to add", () => {
    const read = readCustomHostnameStatus({
      status: "pending",
      ownership_verification: {
        type: "txt",
        name: "_cf-custom-hostname.clientsite.com",
        value: "abc",
      },
      ssl: {
        status: "pending_validation",
        validation_records: [
          { txt_name: "_acme-challenge.clientsite.com", txt_value: "xyz" },
        ],
      },
    });

    expect(read.verification.ownership).toEqual([
      {
        name: "_cf-custom-hostname.clientsite.com",
        type: "txt",
        value: "abc",
      },
    ]);
    expect(read.verification.ssl).toEqual([
      { name: "_acme-challenge.clientsite.com", type: "TXT", value: "xyz" },
    ]);
  });

  it("reports a terminal Cloudflare state as failed", () => {
    expect(readCustomHostnameStatus({ status: "moved", ssl: {} }).status).toBe(
      "failed",
    );
  });

  it("keeps a hostname the owner has simply not validated yet in verifying", () => {
    const read = readCustomHostnameStatus({
      status: "pending",
      ssl: {
        status: "pending_validation",
        validation_errors: [{ message: "no TXT record found" }],
      },
    });
    expect(read.status).toBe("verifying");
    expect(read.verification.error).toBe("no TXT record found");
  });
});

describe("CloudflareCustomHostnameClient", () => {
  it("asks for TXT DV so the owner never has to serve a file", async () => {
    const { instance, calls } = client(() =>
      envelope({
        id: "ch1",
        hostname: "www.clientsite.com",
        status: "pending",
        ssl: {},
      }),
    );
    const created = await instance.create("www.clientsite.com");

    expect(created.id).toBe("ch1");
    const body = calls[0]?.body as { ssl: { method: string; type: string } };
    expect(body.ssl.method).toBe("txt");
    expect(body.ssl.type).toBe("dv");
  });

  it("treats a hostname that is already gone as deleted", async () => {
    const { instance } = client(
      () =>
        new Response(
          JSON.stringify({ success: false, errors: [{ code: 1436 }] }),
          { status: 404 },
        ),
    );
    expect(await instance.delete("ch1")).toBe(false);
    expect(await instance.get("ch1")).toBeNull();
  });
});

describe("defaultDomainMode", () => {
  it("never spends SaaS quota on a name in the zone we own", () => {
    expect(defaultDomainMode("app.denizlg24.com", "denizlg24.com")).toBe(
      "zone_record",
    );
    expect(defaultDomainMode("www.clientsite.com", "denizlg24.com")).toBe(
      "custom_hostname",
    );
  });

  it("does not mistake a suffix for a subdomain", () => {
    expect(isZoneHostname("notdenizlg24.com", "denizlg24.com")).toBe(false);
  });
});
