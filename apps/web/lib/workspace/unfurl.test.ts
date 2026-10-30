import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pageMetadata } from "@/lib/fetch-url-metadata";
import { guardedLookup, UnfurlRefused, unfurl } from "./unfurl";

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>internal</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

function lookupOnce(
  addresses: { address: string; family: number }[],
): Promise<string> {
  const lookup = guardedLookup((_host, done) => done(null, addresses));
  return new Promise((resolve, reject) =>
    lookup("host.test", {}, (error, address) =>
      error ? reject(error) : resolve(String(address)),
    ),
  );
}

describe("bookmark unfurling", () => {
  test("the guarded lookup refuses any private answer, including a mixed one", async () => {
    await expect(
      lookupOnce([{ address: "93.184.216.34", family: 4 }]),
    ).resolves.toBe("93.184.216.34");
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "169.254.169.254",
      "100.100.100.100",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      await expect(
        lookupOnce([{ address, family: address.includes(":") ? 6 : 4 }]),
      ).rejects.toThrow(UnfurlRefused);
    }
    await expect(
      lookupOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow(/private/);
  });

  test("a literal private address is refused before any request", async () => {
    await expect(unfurl(`http://127.0.0.1:${port}/`)).rejects.toThrow(
      UnfurlRefused,
    );
    await expect(unfurl("http://[::1]/")).rejects.toThrow(UnfurlRefused);
    await expect(unfurl("http://169.254.169.254/latest")).rejects.toThrow(
      UnfurlRefused,
    );
  });

  test("a name that resolves inward never connects", async () => {
    const resolve = (
      _host: string,
      done: (
        error: Error | null,
        a: { address: string; family: number }[],
      ) => void,
    ) => done(null, [{ address: "127.0.0.1", family: 4 }]);
    await expect(
      unfurl(`http://rebound.test:${port}/`, { resolve }),
    ).rejects.toThrow(/private/);
  });

  test("only http and https unfurl", async () => {
    await expect(unfurl("file:///etc/passwd")).rejects.toThrow(UnfurlRefused);
    await expect(unfurl("http://user:pw@example.com/")).rejects.toThrow(
      UnfurlRefused,
    );
  });

  test("page metadata prefers Open Graph and resolves relative images", () => {
    expect(
      pageMetadata(
        '<head><title>Plain</title><meta property="og:title" content="OG &amp; co"><meta property="og:image" content="/a.png"><meta name="description" content="Desc"></head>',
        "https://example.com/post",
      ),
    ).toEqual({
      title: "OG & co",
      description: "Desc",
      image: "https://example.com/a.png",
      siteName: undefined,
    });
  });
});
