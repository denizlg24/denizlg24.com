import { join } from "node:path";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveCalories,
  deriveOmega3,
  parseCell,
  type ResearchFood,
  type ResearchReader,
} from "../types";

const RELEASE = "2025_11_03";

/** Ciqual constituent codes in preference order per key. */
const CONSTITUENTS: [NutrientKey, string[]][] = [
  ["calories", ["328", "333"]],
  ["water", ["400"]],
  ["ash", ["10000"]],
  ["protein", ["25000", "25003"]],
  ["carbs", ["31000"]],
  ["sugar", ["32000"]],
  ["fructose", ["32210"]],
  ["glucose", ["32250"]],
  ["lactose", ["32410"]],
  ["maltose", ["32430"]],
  ["sucrose", ["32480"]],
  ["starch", ["33110"]],
  ["polyols", ["34000"]],
  ["fiber", ["34100"]],
  ["fat", ["40000"]],
  ["saturated", ["40302"]],
  ["monoUnsaturated", ["40303"]],
  ["polyUnsaturated", ["40304"]],
  ["omega3Ala", ["41833"]],
  ["omega3Epa", ["42053"]],
  ["omega3Dha", ["42263"]],
  ["alcohol", ["60000"]],
  ["cholesterol", ["75100"]],
  ["magnesium", ["10120"]],
  ["phosphorus", ["10150"]],
  ["potassium", ["10190"]],
  ["calcium", ["10200"]],
  ["manganese", ["10251"]],
  ["iron", ["10260"]],
  ["copper", ["10290"]],
  ["zinc", ["10300"]],
  ["selenium", ["10340"]],
  ["a", ["51104"]],
  ["retinol", ["51200"]],
  ["caroteneBeta", ["51330"]],
  ["d", ["52100"]],
  ["e", ["71010", "53100"]],
  ["k", ["54101"]],
  ["c", ["55100"]],
  ["b1", ["56100"]],
  ["b2", ["56200"]],
  ["b3", ["56310"]],
  ["b5", ["56400"]],
  ["b6", ["56500"]],
  ["b12", ["56600"]],
  ["folate", ["56700"]],
  ["folateDfe", ["56702"]],
];

const KILOJOULES = ["327", "332"];
const SALT = "10004";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&apos;": "'",
  "&quot;": '"',
};

const decodeEntities = (text: string) =>
  text.replace(
    /&(lt|gt|amp|apos|quot);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );

/** Honours the encoding named in the XML declaration; older releases were windows-1252. */
const readXml = async (path: string): Promise<string> => {
  const bytes = await Bun.file(path).arrayBuffer();
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const encoding =
    /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ?? "utf-8";
  return new TextDecoder(encoding.trim().toLowerCase()).decode(bytes);
};

/** Each `<tag>` record as its child elements; self-closing `missing` children are left out. */
function* records(xml: string, tag: string): Generator<Map<string, string>> {
  const record = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (const match of xml.matchAll(record)) {
    const fields = new Map<string, string>();
    for (const field of (match[1] ?? "").matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
      const [, name, value] = field;
      if (name && value !== undefined)
        fields.set(name, decodeEntities(value).trim());
    }
    yield fields;
  }
}

const present = (value: string | undefined) =>
  value && value !== "-" ? value : undefined;

/**
 * The unit is only published inside the constituent's name, e.g. "Protein
 * (g/100g)". Vitamin A is labelled "µg/100mg", a typo for µg/100 g: its
 * values are of the same magnitude as retinol's.
 */
const unitOf = (name: string): string | undefined =>
  /\((kJ|kcal|g|mg|µg)\/100\s*m?g\)/.exec(name.replace("μ", "µ"))?.[1];

/**
 * ANSES-CIQUAL, the French food composition table. Every value is per 100 g
 * of edible portion. Carbohydrate is available carbohydrate and sodium is
 * only published as salt (Na × 2.5).
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const [alim, groupsXml, constXml, compo] = await Promise.all([
    readXml(join(dir, `alim_${RELEASE}.xml`)),
    readXml(join(dir, `alim_grp_${RELEASE}.xml`)),
    readXml(join(dir, `const_${RELEASE}.xml`)),
    readXml(join(dir, `compo_${RELEASE}.xml`)),
  ]);

  const groups = new Map<string, string>();
  const subGroups = new Map<string, string>();
  for (const row of records(groupsXml, "ALIM_GRP")) {
    const group = row.get("alim_grp_code");
    const groupName = present(row.get("alim_grp_nom_eng"));
    if (group && groupName) groups.set(group, groupName);
    const subGroup = row.get("alim_ssgrp_code");
    const subGroupName = present(row.get("alim_ssgrp_nom_eng"));
    if (subGroup && subGroupName) subGroups.set(subGroup, subGroupName);
  }

  const units = new Map<string, string>();
  for (const row of records(constXml, "CONST")) {
    const code = row.get("const_code");
    const unit = unitOf(row.get("const_nom_eng") ?? "");
    if (code && unit) units.set(code, unit);
  }

  const readings = new Map<string, Map<string, string>>();
  for (const row of records(compo, "COMPO")) {
    const food = row.get("alim_code");
    const constituent = row.get("const_code");
    const value = row.get("teneur");
    if (!food || !constituent || value === undefined) continue;
    let cells = readings.get(food);
    if (!cells) {
      cells = new Map();
      readings.set(food, cells);
    }
    cells.set(constituent, value);
  }

  const foods: ResearchFood[] = [];
  for (const row of records(alim, "ALIM")) {
    const code = row.get("alim_code");
    const name = present(row.get("alim_nom_fr"));
    if (!code || !name) continue;
    const cells = readings.get(code) ?? new Map<string, string>();

    const values: NutrientValues = {};
    for (const [key, codes] of CONSTITUENTS) {
      for (const constituent of codes) {
        const unit = units.get(constituent);
        const raw = cells.get(constituent);
        if (unit && raw !== undefined) assign(values, key, raw, unit);
      }
    }

    const salt = parseCell(cells.get(SALT));
    if (salt !== undefined && units.get(SALT) === "g") {
      assign(values, "sodium", (salt * 1000) / 2.5, "mg");
    }
    for (const constituent of KILOJOULES) {
      const kilojoules = parseCell(cells.get(constituent));
      if (units.get(constituent) === "kJ") deriveCalories(values, kilojoules);
    }
    deriveOmega3(values);

    const subGroup = row.get("alim_ssgrp_code");
    const group = row.get("alim_grp_code");
    foods.push({
      sourceId: code,
      name,
      nameEn: present(row.get("alim_nom_eng")) ?? null,
      foodGroup:
        (subGroup ? subGroups.get(subGroup) : undefined) ??
        (group ? groups.get(group) : undefined) ??
        null,
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "ciqual",
  region: "fr",
  dir: "ciqual",
  read,
};
