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

  it("asks for nothing beyond the CNAME under HTTP DCV", () => {
    // The shape Cloudflare returns while it waits for the CNAME to resolve.
    // The ownership TXT it offers is the alternative to pointing the hostname,
    // and pointing the hostname is not optional here, so showing it would make
    // a one-record job look like two.
    const read = readCustomHostnameStatus({
      status: "pending",
      ownership_verification: {
        type: "txt",
        name: "_cf-custom-hostname.clientsite.com",
        value: "abc",
      },
      ssl: { status: "pending_validation" },
    });

    expect(read.verification.ownership).toEqual([]);
    expect(read.verification.ssl).toEqual([]);
  });

  it("still surfaces a DV record when Cloudflare falls back to asking for one", () => {
    const read = readCustomHostnameStatus({
      status: "pending",
      ssl: {
        status: "pending_validation",
        validation_records: [
          { txt_name: "_acme-challenge.clientsite.com", txt_value: "xyz" },
        ],
      },
    });

    expect(read.verification.ssl).toEqual([
      { name: "_acme-challenge.clientsite.com", type: "TXT", value: "xyz" },
    ]);
  });

  it("surfaces ownership and certificate records for TXT validation", () => {
    const read = readCustomHostnameStatus({
      status: "pending",
      ownership_verification: {
        type: "txt",
        name: "_cf-custom-hostname.clientsite.com",
        value: "ownership-token",
      },
      ssl: {
        method: "txt",
        status: "pending_validation",
        validation_records: [
          { txt_name: "_acme-challenge.clientsite.com", txt_value: "dv-token" },
        ],
      },
    });

    expect(read.verification.ownership).toEqual([
      {
        name: "_cf-custom-hostname.clientsite.com",
        type: "TXT",
        value: "ownership-token",
      },
    ]);
    expect(read.verification.ssl).toEqual([
      {
        name: "_acme-challenge.clientsite.com",
        type: "TXT",
        value: "dv-token",
      },
    ]);
  });

  it("carries a manual HTTP token in the same three columns", () => {
    const read = readCustomHostnameStatus({
      status: "pending",
      ssl: {
        status: "pending_validation",
        validation_records: [
          {
            http_url:
              "http://clientsite.com/.well-known/pki-validation/ca3.txt",
            http_body: "token-body",
          },
        ],
      },
    });

    expect(read.verification.ssl).toEqual([
      {
        name: "http://clientsite.com/.well-known/pki-validation/ca3.txt",
        type: "HTTP",
        value: "token-body",
      },
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
  it("asks for HTTP DV so the owner only has to add the CNAME", async () => {
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
    expect(body.ssl.method).toBe("http");
    expect(body.ssl.type).toBe("dv");
  });

  it("can ask for TXT DV", async () => {
    const { instance, calls } = client(() =>
      envelope({
        id: "ch1",
        hostname: "www.clientsite.com",
        status: "pending",
        ownership_verification: {
          name: "_cf-custom-hostname.clientsite.com",
          value: "ownership-token",
        },
        // Some create responses omit the echoed method; the requested method
        // must still govern which setup records are returned to the UI.
        ssl: { status: "pending_validation" },
      }),
    );
    const created = await instance.create("www.clientsite.com", "txt");

    const body = calls[0]?.body as { ssl: { method: string; type: string } };
    expect(body.ssl.method).toBe("txt");
    expect(body.ssl.type).toBe("dv");
    expect(created.verification.ownership).toEqual([
      {
        name: "_cf-custom-hostname.clientsite.com",
        type: "TXT",
        value: "ownership-token",
      },
    ]);
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
