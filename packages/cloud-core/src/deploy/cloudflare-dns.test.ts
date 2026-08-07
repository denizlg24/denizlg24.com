import { describe, expect, it } from "bun:test";

import {
  CloudflareApiError,
  CloudflareDnsClient,
  type CloudflareDnsRecord,
  deploymentRecordComment,
  HostnameConflictError,
  isForgeManagedRecord,
} from "./cloudflare-dns";

const CONFIG = {
  apiToken: "cf-token",
  zoneId: "zone-1",
  zoneName: "denizlg24.com",
  tunnelId: "tunnel-1",
};

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

function fakeFetch(
  responder: (call: Call) => { status?: number; body: unknown },
): { implementation: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const handler = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: headers.get("authorization"),
    };
    calls.push(call);
    const { status = 200, body } = responder(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    implementation: Object.assign(handler, { preconnect: () => {} }),
    calls,
  };
}

function client(responder: Parameters<typeof fakeFetch>[0]) {
  const fetcher = fakeFetch(responder);
  return {
    calls: fetcher.calls,
    instance: new CloudflareDnsClient({
      config: CONFIG,
      fetchImplementation: fetcher.implementation,
    }),
  };
}

function record(overrides: Partial<CloudflareDnsRecord> = {}) {
  return {
    id: "rec-1",
    name: "docs.denizlg24.com",
    type: "CNAME",
    content: "tunnel-1.cfargotunnel.com",
    proxied: true,
    comment: deploymentRecordComment("dep-1"),
    ...overrides,
  };
}

describe("isForgeManagedRecord", () => {
  it("distinguishes ours from everything else in the zone", () => {
    expect(isForgeManagedRecord(record())).toBe(true);
    expect(isForgeManagedRecord(record({ comment: null }))).toBe(false);
    expect(isForgeManagedRecord(record({ comment: "admin panel" }))).toBe(
      false,
    );
  });
});

describe("createDeploymentRecord", () => {
  it("creates a proxied CNAME at the tunnel, tagged with the deployment", async () => {
    const { instance, calls } = client(() => ({
      body: { success: true, errors: [], result: record() },
    }));

    const created = await instance.createDeploymentRecord({
      hostname: "docs.denizlg24.com",
      deploymentId: "dep-1",
    });

    expect(created.id).toBe("rec-1");
    expect(calls[0]?.authorization).toBe("Bearer cf-token");
    expect(calls[0]?.url).toContain("/zones/zone-1/dns_records");
    expect(calls[0]?.body).toEqual({
      type: "CNAME",
      name: "docs.denizlg24.com",
      content: "tunnel-1.cfargotunnel.com",
      proxied: true,
      ttl: 1,
      comment: "forge deployment dep-1",
    });
  });

  it("reports Cloudflare's own error rather than a bare status", async () => {
    const { instance } = client(() => ({
      status: 400,
      body: {
        success: false,
        errors: [
          { code: 81_053, message: "An A, AAAA or CNAME record exists" },
        ],
        result: null,
      },
    }));

    await expect(
      instance.createDeploymentRecord({
        hostname: "docs.denizlg24.com",
        deploymentId: "dep-1",
      }),
    ).rejects.toThrow(/81053: An A, AAAA or CNAME record exists/);
  });

  it("treats a 200 that says success:false as a failure", async () => {
    const { instance } = client(() => ({
      body: { success: false, errors: [], result: null },
    }));
    await expect(
      instance.createDeploymentRecord({
        hostname: "docs.denizlg24.com",
        deploymentId: "dep-1",
      }),
    ).rejects.toBeInstanceOf(CloudflareApiError);
  });
});

describe("deleteRecord", () => {
  it("deletes", async () => {
    const { instance, calls } = client(() => ({
      body: { success: true, errors: [], result: { id: "rec-1" } },
    }));
    expect(await instance.deleteRecord("rec-1")).toBe(true);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/dns_records/rec-1");
  });

  it("counts an already-deleted record as done, never as a blocker", async () => {
    const { instance } = client(() => ({
      status: 404,
      body: {
        success: false,
        errors: [{ code: 81_044, message: "Record does not exist." }],
        result: null,
      },
    }));
    expect(await instance.deleteRecord("rec-gone")).toBe(false);
  });

  it("still raises a real failure", async () => {
    const { instance } = client(() => ({
      status: 403,
      body: {
        success: false,
        errors: [{ code: 10_000, message: "Authentication error" }],
        result: null,
      },
    }));
    await expect(instance.deleteRecord("rec-1")).rejects.toBeInstanceOf(
      CloudflareApiError,
    );
  });
});

describe("assertHostnameAvailable", () => {
  it("refuses a reserved name without asking Cloudflare", async () => {
    const { instance, calls } = client(() => ({
      body: { success: true, errors: [], result: [] },
    }));
    await expect(
      instance.assertHostnameAvailable("cloud.denizlg24.com"),
    ).rejects.toThrow(/reserved/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a name that already points somewhere we did not point it", async () => {
    const { instance } = client(() => ({
      body: {
        success: true,
        errors: [],
        result: [record({ name: "blog.denizlg24.com", comment: null })],
      },
    }));
    await expect(
      instance.assertHostnameAvailable("blog.denizlg24.com"),
    ).rejects.toBeInstanceOf(HostnameConflictError);
  });

  it("allows a name whose only record is one of ours", async () => {
    const { instance } = client(() => ({
      body: { success: true, errors: [], result: [record()] },
    }));
    expect(await instance.assertHostnameAvailable("DOCS.denizlg24.com")).toBe(
      "docs.denizlg24.com",
    );
  });

  it("allows a free name", async () => {
    const { instance } = client(() => ({
      body: { success: true, errors: [], result: [] },
    }));
    expect(await instance.assertHostnameAvailable("fresh.denizlg24.com")).toBe(
      "fresh.denizlg24.com",
    );
  });
});

describe("listManagedRecords", () => {
  it("pages until the zone runs out", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) =>
        record({ id: `rec-${index}`, name: `a${index}.denizlg24.com` }),
      ),
      [record({ id: "rec-last" })],
    ];
    const { instance, calls } = client((call) => {
      const page = Number(new URL(call.url).searchParams.get("page") ?? "1");
      return {
        body: { success: true, errors: [], result: pages[page - 1] ?? [] },
      };
    });

    const records = await instance.listManagedRecords();
    expect(records).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it("never returns a record it does not own, whatever the filter did", async () => {
    const { instance } = client(() => ({
      body: {
        success: true,
        errors: [],
        result: [record(), record({ id: "rec-2", comment: "hand-made" })],
      },
    }));
    const records = await instance.listManagedRecords();
    expect(records.map((entry) => entry.id)).toEqual(["rec-1"]);
  });
});
