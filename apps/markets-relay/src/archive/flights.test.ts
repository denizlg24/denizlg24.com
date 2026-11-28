import { expect, test } from "bun:test";
import {
  matchCompany,
  parseMasterHeader,
  parseMasterLine,
  splitCsvLine,
} from "./faa";
import { FLIGHT_COMPANIES } from "./flight-companies";
import {
  emptyState,
  expire,
  type FlightEvent,
  GAP_MS,
  type Observation,
  observe,
  STORE_EVERY_MS,
  type TrackState,
} from "./segments";
import { parseAdsbLol, parseOpenSky } from "./tracking";

const header =
  "﻿N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR, KIT MODEL,MODE S CODE HEX,";

function masterLine(fields: Record<number, string>): string {
  const cells = new Array<string>(35).fill("");
  for (const [index, value] of Object.entries(fields)) {
    cells[Number(index)] = value;
  }
  return cells.join(",");
}

const columns = parseMasterHeader(header);

test("reads column positions from the header, BOM included", () => {
  expect(columns).toEqual({
    nNumber: 0,
    name: 6,
    status: 20,
    modeSHex: 33,
    type: 18,
    modelCode: 2,
    year: 4,
  });
});

test("fails loudly when the header loses a column", () => {
  expect(() => parseMasterHeader("N-NUMBER,NAME")).toThrow(/STATUS CODE/);
});

test("parses a padded MASTER line", () => {
  const line = masterLine({
    0: "940AM",
    2: "2130004",
    4: "2015",
    6: "ORACLE AVIATION LLC                               ",
    18: "4",
    20: "V ",
    33: "AD0D34    ",
  });
  expect(parseMasterLine(line, columns)).toEqual({
    nNumber: "N940AM",
    owner: "ORACLE AVIATION LLC",
    status: "V",
    icao24: "ad0d34",
    aircraftType: "4",
    modelCode: "2130004",
    year: "2015",
  });
});

test("skips lines without a usable Mode S hex", () => {
  expect(
    parseMasterLine(masterLine({ 0: "1", 6: "X", 33: "" }), columns),
  ).toBeNull();
  expect(
    parseMasterLine(masterLine({ 0: "1", 6: "X", 33: "ZZZZZZ" }), columns),
  ).toBeNull();
});

test("splits quoted fields", () => {
  expect(splitCsvLine('A,"B, INC",C""')).toEqual(["A", "B, INC", "C"]);
});

test("matches owner names by anchored pattern, active registrations only", () => {
  const record = (owner: string, status = "V", aircraftType = "4") => ({
    nNumber: "N1",
    owner,
    status,
    icao24: "aaaaaa",
    aircraftType,
    modelCode: "",
    year: "",
  });
  expect(matchCompany(record("WALMART INC"), FLIGHT_COMPANIES)).toBe("WMT");
  expect(matchCompany(record("WALMART INC", "E"), FLIGHT_COMPANIES)).toBeNull();
  expect(
    matchCompany(record("APPLE FARM SERVICE INC"), FLIGHT_COMPANIES),
  ).toBeNull();
  expect(
    matchCompany(record("NETJETS SALES INC"), FLIGHT_COMPANIES),
  ).toBeNull();
  expect(
    matchCompany(record("AMAZON.COM SERVICES LLC", "V", "6"), FLIGHT_COMPANIES),
  ).toBeNull();
  expect(
    matchCompany(record("AMAZON.COM SERVICES LLC", "V", "5"), FLIGHT_COMPANIES),
  ).toBe("AMZN");
});

const minute = 60_000;
const t0 = Date.UTC(2026, 10, 28, 12, 0, 0);

function obs(
  minutes: number,
  ground: boolean,
  lat = 40,
  lon = -74,
): Observation {
  return {
    at: t0 + minutes * minute,
    lat,
    lon,
    ground,
    altFt: ground ? null : 30000,
    gsKt: ground ? 0 : 400,
    trackDeg: 90,
  };
}

function run(sequence: Observation[]): {
  state: TrackState;
  events: FlightEvent[];
  stored: number[];
} {
  let state = emptyState();
  const events: FlightEvent[] = [];
  const stored: number[] = [];
  for (const o of sequence) {
    const outcome = observe(state, o);
    state = outcome.state;
    events.push(...outcome.events);
    if (outcome.store) stored.push((o.at - t0) / minute);
  }
  return { state, events, stored };
}

test("a ground to air to ground sequence is one observed flight", () => {
  const { events, state } = run([
    obs(0, true, 10, 20),
    obs(3, false, 10.1, 20.1),
    obs(6, false, 11, 21),
    obs(26, false, 20, 30),
    obs(46, false, 25, 35),
    obs(60, true, 30, 40),
  ]);
  expect(events).toEqual([
    { kind: "departed", at: t0 + 3 * minute, lat: 10, lon: 20, observed: true },
    {
      kind: "arrived",
      departedAt: t0 + 3 * minute,
      at: t0 + 60 * minute,
      lat: 30,
      lon: 40,
      observed: true,
    },
  ]);
  expect(state.open).toBeNull();
});

test("first sight already airborne is a departure that was not observed", () => {
  const { events } = run([obs(0, false, 10, 20)]);
  expect(events).toEqual([
    { kind: "departed", at: t0, lat: 10, lon: 20, observed: false },
  ]);
});

test("a stale ground fix does not place the departure", () => {
  const { events } = run([obs(0, true, 1, 2), obs(120, false, 10, 20)]);
  expect(events[0]).toMatchObject({
    kind: "departed",
    lat: 10,
    lon: 20,
    observed: false,
  });
});

test("airborne positions are stored every few minutes, not every poll", () => {
  const sequence = [obs(0, true)];
  for (let m = 3; m <= 30; m += 3) sequence.push(obs(m, false));
  const { stored } = run(sequence);
  expect(stored).toEqual([0, 3, 9, 15, 21, 27]);
  expect(STORE_EVERY_MS).toBe(5 * minute);
});

test("repeated ground fixes are not stored again", () => {
  const { stored } = run([obs(0, true), obs(3, true), obs(6, true)]);
  expect(stored).toEqual([0]);
});

test("a repeated or older fix is ignored", () => {
  const { events, stored } = run([obs(5, false), obs(5, false), obs(2, false)]);
  expect(events).toHaveLength(1);
  expect(stored).toEqual([5]);
});

test("silence ends an open flight at the last position heard", () => {
  const { state } = run([obs(0, true), obs(3, false, 11, 21)]);
  const early = expire(state, t0 + 3 * minute + GAP_MS);
  expect(early.events).toEqual([]);
  const late = expire(state, t0 + 3 * minute + GAP_MS + 1);
  expect(late.events).toEqual([
    {
      kind: "arrived",
      departedAt: t0 + 3 * minute,
      at: t0 + 3 * minute,
      lat: 11,
      lon: 21,
      observed: false,
    },
  ]);
  expect(late.state.open).toBeNull();
});

test("reappearing after a gap closes the old flight and opens a new one", () => {
  const { events, stored } = run([
    obs(0, true),
    obs(3, false, 11, 21),
    obs(300, false, 50, 60),
  ]);
  expect(events.map((event) => event.kind)).toEqual([
    "departed",
    "arrived",
    "departed",
  ]);
  expect(events[1]).toMatchObject({ observed: false, lat: 11, lon: 21 });
  expect(events[2]).toMatchObject({ observed: false, lat: 50, lon: 60 });
  expect(stored).toContain(300);
});

test("parses adsb.lol aircraft, ground state and fix age", () => {
  const observations = parseAdsbLol({
    now: 1_800_000_000_000,
    ac: [
      {
        hex: "AA3923",
        lat: 40.7,
        lon: -74.3,
        alt_baro: 6325,
        gs: 210.3,
        track: 252.8,
        seen_pos: 2,
      },
      { hex: "a27197", lat: 41, lon: -73, alt_baro: "ground", seen_pos: 0.5 },
      { hex: "0c4185" },
    ],
  });
  expect(observations).toEqual([
    {
      icao24: "aa3923",
      at: 1_799_999_998_000,
      lat: 40.7,
      lon: -74.3,
      ground: false,
      altFt: 6325,
      gsKt: 210.3,
      trackDeg: 252.8,
    },
    {
      icao24: "a27197",
      at: 1_799_999_999_500,
      lat: 41,
      lon: -73,
      ground: true,
      altFt: null,
      gsKt: null,
      trackDeg: null,
    },
  ]);
});

test("parses OpenSky states and converts units", () => {
  const [first] = parseOpenSky({
    time: 1,
    states: [
      [
        "AA3923",
        "LBQ791  ",
        "United States",
        1795854772,
        1795854773,
        -74.5967,
        40.7144,
        1927.86,
        false,
        107.23,
        252.7,
        0,
        null,
        1760.22,
        "1442",
        false,
        0,
      ],
      ["0c4185", null, "x", null, 5, null, null, null, false, null, null],
    ],
  });
  expect(first).toMatchObject({
    icao24: "aa3923",
    at: 1795854772000,
    altFt: 6325,
    ground: false,
  });
  expect(first?.gsKt).toBeCloseTo(208.4, 1);
  expect(parseOpenSky({ time: 1, states: null })).toEqual([]);
});
