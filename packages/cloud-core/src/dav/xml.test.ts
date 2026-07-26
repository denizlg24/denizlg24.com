import { describe, expect, it } from "bun:test";

import {
  buildMultistatus,
  DAV_NS,
  parsePropfind,
  STATUS_NOT_FOUND,
  STATUS_OK,
} from "./xml";

const MS_NS = "urn:schemas-microsoft-com:";

describe("PROPFIND request parsing", () => {
  it("treats an empty body as allprop", () => {
    expect(parsePropfind("")).toEqual({ mode: "allprop" });
    expect(parsePropfind("   \n ")).toEqual({ mode: "allprop" });
  });

  it("reads allprop and propname bodies", () => {
    expect(
      parsePropfind(
        '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>',
      ),
    ).toEqual({ mode: "allprop" });
    expect(
      parsePropfind(
        '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>',
      ),
    ).toEqual({ mode: "propname" });
  });

  it("resolves prefixes to namespaces regardless of spelling", () => {
    const request = parsePropfind(
      '<?xml version="1.0"?><a:propfind xmlns:a="DAV:"><a:prop>' +
        "<a:getcontentlength/><a:resourcetype/></a:prop></a:propfind>",
    );
    expect(request).toEqual({
      mode: "prop",
      props: [
        { ns: DAV_NS, name: "getcontentlength" },
        { ns: DAV_NS, name: "resourcetype" },
      ],
    });
  });

  it("resolves an unprefixed default namespace", () => {
    const request = parsePropfind(
      '<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>',
    );
    expect(request).toEqual({
      mode: "prop",
      props: [{ ns: DAV_NS, name: "displayname" }],
    });
  });

  it("keeps the namespace of vendor properties so they can be reported absent", () => {
    const request = parsePropfind(
      '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">' +
        "<D:prop><D:displayname/><Z:Win32FileAttributes/></D:prop></D:propfind>",
    );
    expect(request).toEqual({
      mode: "prop",
      props: [
        { ns: DAV_NS, name: "displayname" },
        { ns: MS_NS, name: "Win32FileAttributes" },
      ],
    });
  });

  it("does not mistake closing tags for requested properties", () => {
    const request = parsePropfind(
      '<D:propfind xmlns:D="DAV:"><D:prop><D:displayname></D:displayname>' +
        "</D:prop></D:propfind>",
    );
    expect(request).toEqual({
      mode: "prop",
      props: [{ ns: DAV_NS, name: "displayname" }],
    });
  });
});

describe("multistatus rendering", () => {
  it("declares a prefix for every namespace it used", () => {
    const xml = buildMultistatus([
      {
        href: "/dav/home/report.pdf",
        propstats: [
          {
            status: STATUS_OK,
            props: [{ ns: DAV_NS, name: "getcontentlength", value: "12" }],
          },
          {
            status: STATUS_NOT_FOUND,
            props: [{ ns: MS_NS, name: "Win32FileAttributes" }],
          },
        ],
      },
    ]);
    expect(xml).toContain('xmlns:D="DAV:"');
    expect(xml).toContain(`xmlns:N1="${MS_NS}"`);
    expect(xml).toContain("<D:getcontentlength>12</D:getcontentlength>");
    expect(xml).toContain("<N1:Win32FileAttributes/>");
    expect(xml).toContain("<D:status>HTTP/1.1 404 Not Found</D:status>");
  });

  it("omits propstat blocks that carry no properties", () => {
    const xml = buildMultistatus([
      {
        href: "/dav/home",
        propstats: [
          {
            status: STATUS_OK,
            props: [{ ns: DAV_NS, name: "resourcetype", value: "" }],
          },
          { status: STATUS_NOT_FOUND, props: [] },
        ],
      },
    ]);
    expect(xml).not.toContain("404");
    // An empty value is a real value: `resourcetype` on a plain file is an
    // empty element, not a missing property.
    expect(xml).toContain("<D:resourcetype/>");
  });

  it("escapes hrefs and text values", () => {
    const xml = buildMultistatus([
      {
        href: "/dav/home/a&b.txt",
        propstats: [
          {
            status: STATUS_OK,
            props: [{ ns: DAV_NS, name: "displayname", value: "a&amp;b.txt" }],
          },
        ],
      },
    ]);
    expect(xml).toContain("<D:href>/dav/home/a&amp;b.txt</D:href>");
  });
});
