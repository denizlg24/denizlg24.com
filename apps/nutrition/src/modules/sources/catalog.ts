import type { ItemSource } from "../../db/schema";

export interface SourceDescription {
  id: ItemSource;
  name: string;
  publisher: string;
  /** ISO 3166-1 alpha-2, lowercase; null for multinational data. */
  region: string | null;
  version: string;
  license: string;
  citation: string;
  url: string;
  /** Lab-analysed reference data ranks above label data in search. */
  kind: "research" | "branded" | "user";
}

/**
 * Every dataset the API serves, with the attribution its licence requires.
 * Ordered by search preference: within one food concept, the first source
 * listed wins a tie in text relevance.
 */
export const sourceCatalog = [
  {
    id: "usda_foundation",
    name: "USDA Foundation Foods",
    publisher: "U.S. Department of Agriculture, Agricultural Research Service",
    region: "us",
    version: "2026-04-30",
    license: "Public domain (CC0 1.0)",
    citation:
      "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: Foundation Foods, 2026.",
    url: "https://fdc.nal.usda.gov/",
    kind: "research",
  },
  {
    id: "usda_sr_legacy",
    name: "USDA SR Legacy",
    publisher: "U.S. Department of Agriculture, Agricultural Research Service",
    region: "us",
    version: "2018-04",
    license: "Public domain (CC0 1.0)",
    citation:
      "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: SR Legacy, 2018.",
    url: "https://fdc.nal.usda.gov/",
    kind: "research",
  },
  {
    id: "usda_fndds",
    name: "USDA Food and Nutrient Database for Dietary Studies",
    publisher: "U.S. Department of Agriculture, Agricultural Research Service",
    region: "us",
    version: "2021-2023 (FDC 2024-10-31)",
    license: "Public domain (CC0 1.0)",
    citation:
      "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: FNDDS 2021-2023, 2024.",
    url: "https://fdc.nal.usda.gov/",
    kind: "research",
  },
  {
    id: "cnf",
    name: "Canadian Nutrient File",
    publisher: "Health Canada",
    region: "ca",
    version: "2015",
    license: "Open Government Licence – Canada",
    citation: "Health Canada. Canadian Nutrient File, 2015.",
    url: "https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data.html",
    kind: "research",
  },
  {
    id: "cofid",
    name: "McCance and Widdowson's Composition of Foods Integrated Dataset",
    publisher:
      "Public Health England / Office for Health Improvement and Disparities",
    region: "gb",
    version: "2021",
    license: "Open Government Licence v3.0",
    citation:
      "Public Health England. McCance and Widdowson's The Composition of Foods Integrated Dataset, 2021.",
    url: "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid",
    kind: "research",
  },
  {
    id: "ciqual",
    name: "ANSES-CIQUAL French food composition table",
    publisher: "ANSES",
    region: "fr",
    version: "2025",
    license: "Etalab Open Licence 2.0",
    citation:
      "Anses. Ciqual French food composition table, 2025. https://ciqual.anses.fr/",
    url: "https://ciqual.anses.fr/",
    kind: "research",
  },
  {
    id: "insa",
    name: "Tabela da Composição de Alimentos",
    publisher: "Instituto Nacional de Saúde Doutor Ricardo Jorge (INSA)",
    region: "pt",
    version: "2025",
    license: "Free use with attribution",
    citation:
      "INSA. Tabela da Composição de Alimentos (TCA). Instituto Nacional de Saúde Doutor Ricardo Jorge, 2025. portfir.insa.pt",
    url: "https://portfir.insa.min-saude.pt/",
    kind: "research",
  },
  {
    id: "frida",
    name: "Frida food data",
    publisher: "National Food Institute, Technical University of Denmark (DTU)",
    region: "dk",
    version: "6.1",
    license: "CC BY 4.0",
    citation:
      "Food data (frida.fooddata.dk), version 6.1, National Food Institute, Technical University of Denmark. doi:10.11583/DTU.32312844",
    url: "https://frida.fooddata.dk/",
    kind: "research",
  },
  {
    id: "bls",
    name: "Bundeslebensmittelschlüssel",
    publisher: "Max Rubner-Institut",
    region: "de",
    version: "4.0",
    license: "CC BY 4.0",
    citation:
      "Max Rubner-Institut. Bundeslebensmittelschlüssel (BLS), Version 4.0, 2025. doi:10.25826/Data20251217-134202-0",
    url: "https://blsdb.de/",
    kind: "research",
  },
  {
    id: "matvaretabellen",
    name: "Matvaretabellen (Norwegian Food Composition Table)",
    publisher: "Norwegian Food Safety Authority",
    region: "no",
    version: "2025",
    license: "CC BY 4.0",
    citation:
      "Norwegian Food Composition Database 2025. Norwegian Food Safety Authority. www.matvaretabellen.no",
    url: "https://www.matvaretabellen.no/",
    kind: "research",
  },
  {
    id: "livsmedelsverket",
    name: "Livsmedelsdatabasen (Swedish Food Composition Database)",
    publisher: "Swedish Food Agency (Livsmedelsverket)",
    region: "se",
    version: "2026",
    license: "CC BY 4.0",
    citation: "Livsmedelsverket. Livsmedelsdatabasen, 2026.",
    url: "https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data/",
    kind: "research",
  },
  {
    id: "swiss_fcdb",
    name: "Swiss Food Composition Database",
    publisher: "Federal Food Safety and Veterinary Office (FSVO)",
    region: "ch",
    version: "2026",
    license: "Free use with attribution",
    citation:
      "Swiss Food Composition Database, Federal Food Safety and Veterinary Office FSVO. naehrwertdaten.ch",
    url: "https://naehrwertdaten.ch/",
    kind: "research",
  },
  {
    id: "afcd",
    name: "Australian Food Composition Database",
    publisher: "Food Standards Australia New Zealand",
    region: "au",
    version: "Release 3",
    license: "CC BY 4.0",
    citation:
      "Food Standards Australia New Zealand. Australian Food Composition Database – Release 3. Canberra: FSANZ.",
    url: "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd",
    kind: "research",
  },
  {
    id: "usda_branded",
    name: "USDA Global Branded Food Products Database",
    publisher: "U.S. Department of Agriculture, Agricultural Research Service",
    region: "us",
    version: "2026-04-30",
    license: "Public domain (CC0 1.0)",
    citation:
      "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: Branded Foods, 2026.",
    url: "https://fdc.nal.usda.gov/",
    kind: "branded",
  },
  {
    id: "user",
    name: "User contributions",
    publisher: "Macros users",
    region: null,
    version: "live",
    license: "Contributed",
    citation: "Contributed by Macros users.",
    url: "https://macros.denizlg24.com/",
    kind: "user",
  },
  {
    id: "openfoodfacts",
    name: "Open Food Facts",
    publisher: "Open Food Facts contributors",
    region: null,
    version: "live",
    license: "Open Database License (ODbL) 1.0",
    citation: "Open Food Facts contributors, https://world.openfoodfacts.org",
    url: "https://world.openfoodfacts.org/",
    kind: "branded",
  },
] as const satisfies readonly SourceDescription[];

export type CatalogSource = (typeof sourceCatalog)[number]["id"];

/**
 * Search tiebreaker. Research tables outrank label data, and within research
 * the ordering above holds. Two values per step leave room for the label
 * sources below without colliding.
 */
export const sourceRankFor = (source: string) => {
  const index = sourceCatalog.findIndex((entry) => entry.id === source);
  return index === -1 ? 0 : (sourceCatalog.length - index) * 2;
};
