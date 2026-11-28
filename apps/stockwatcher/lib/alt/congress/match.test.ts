import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { type Legislator, matchLegislator } from "./match";
import { unzipEntry } from "./zip";

const person = (over: Partial<Legislator>): Legislator => ({
  bioguide: "X000000",
  name: "N",
  party: "Republican",
  state: "VA",
  chamber: "house",
  district: 1,
  url: null,
  first: "Robert",
  last: "Wittman",
  nickname: "Rob",
  ...over,
});

describe("matchLegislator", () => {
  const list = [
    person({ bioguide: "W000804", state: "VA" }),
    person({
      bioguide: "S001217",
      first: "Rick",
      last: "Scott",
      state: "FL",
      chamber: "senate",
      nickname: null,
    }),
    person({
      bioguide: "S001184",
      first: "Tim",
      last: "Scott",
      state: "SC",
      chamber: "senate",
      nickname: null,
    }),
  ];

  test("matches a House filer by last name and state", () => {
    expect(
      matchLegislator(list, {
        first: "Robert J.",
        last: "Wittman",
        chamber: "house",
        state: "VA",
      })?.bioguide,
    ).toBe("W000804");
    expect(
      matchLegislator(list, {
        first: "Robert",
        last: "Wittman",
        chamber: "house",
        state: "TX",
      }),
    ).toBeNull();
  });

  test("separates senators sharing a last name by first name, and refuses to guess", () => {
    expect(
      matchLegislator(list, {
        first: "Timothy E",
        last: "Scott",
        chamber: "senate",
      })?.bioguide,
    ).toBe("S001184");
    expect(
      matchLegislator(list, { first: "Pat", last: "Scott", chamber: "senate" }),
    ).toBeNull();
  });
});

describe("unzipEntry", () => {
  test("reads a deflated entry from the central directory", () => {
    const name = new TextEncoder().encode("2026FD.xml");
    const body = new TextEncoder().encode("<a>hello</a>");
    const data = deflateRawSync(body);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, 0, true);
    central.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(16, local.length, true);
    const zip = new Uint8Array([...local, ...central, ...end]);
    expect(
      new TextDecoder().decode(
        unzipEntry(zip, "2026FD.xml") ?? new Uint8Array(),
      ),
    ).toBe("<a>hello</a>");
    expect(unzipEntry(zip, "missing")).toBeNull();
  });
});
