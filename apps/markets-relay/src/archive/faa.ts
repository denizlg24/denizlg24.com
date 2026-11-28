export interface CompanyPattern {
  ticker: string;
  owner: RegExp;
  /** MASTER "TYPE AIRCRAFT" codes to keep; defaults to every type. */
  types?: string[];
}

export interface MasterColumns {
  nNumber: number;
  name: number;
  status: number;
  modeSHex: number;
  type: number;
  modelCode: number;
  year: number;
}

export interface MasterRecord {
  nNumber: string;
  owner: string;
  status: string;
  icao24: string;
  aircraftType: string;
  modelCode: string;
  year: string;
}

export interface RegistryMatch extends MasterRecord {
  ticker: string;
}

/** V valid, M valid manufacturer, T valid non-citizen corporation. */
const ACTIVE_STATUS = new Set(["V", "M", "T"]);

export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

const REQUIRED_HEADERS = {
  nNumber: "N-NUMBER",
  name: "NAME",
  status: "STATUS CODE",
  modeSHex: "MODE S CODE HEX",
  type: "TYPE AIRCRAFT",
  modelCode: "MFR MDL CODE",
  year: "YEAR MFR",
} as const;

export function parseMasterHeader(line: string): MasterColumns {
  const names = splitCsvLine(line.replace(/^﻿|^ï»¿/, "")).map((name) =>
    name.trim().toUpperCase(),
  );
  const index = (header: string): number => {
    const found = names.indexOf(header);
    if (found < 0) throw new Error(`MASTER.txt has no ${header} column`);
    return found;
  };
  return {
    nNumber: index(REQUIRED_HEADERS.nNumber),
    name: index(REQUIRED_HEADERS.name),
    status: index(REQUIRED_HEADERS.status),
    modeSHex: index(REQUIRED_HEADERS.modeSHex),
    type: index(REQUIRED_HEADERS.type),
    modelCode: index(REQUIRED_HEADERS.modelCode),
    year: index(REQUIRED_HEADERS.year),
  };
}

export function parseMasterLine(
  line: string,
  columns: MasterColumns,
): MasterRecord | null {
  const fields = splitCsvLine(line);
  const field = (index: number): string => (fields[index] ?? "").trim();
  const icao24 = field(columns.modeSHex).toLowerCase();
  const owner = field(columns.name).toUpperCase();
  const nNumber = field(columns.nNumber);
  if (!/^[0-9a-f]{6}$/.test(icao24) || !owner || !nNumber) return null;
  return {
    nNumber: `N${nNumber}`,
    owner,
    status: field(columns.status),
    icao24,
    aircraftType: field(columns.type),
    modelCode: field(columns.modelCode),
    year: field(columns.year),
  };
}

export function matchCompany(
  record: MasterRecord,
  companies: CompanyPattern[],
): string | null {
  if (!ACTIVE_STATUS.has(record.status)) return null;
  for (const company of companies) {
    if (!company.owner.test(record.owner)) continue;
    if (company.types && !company.types.includes(record.aircraftType)) continue;
    return company.ticker;
  }
  return null;
}
