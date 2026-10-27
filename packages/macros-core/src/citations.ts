/**
 * Where every health figure Macros calculates or recommends comes from. App
 * Review (guideline 1.4.1) requires these to be easy to find next to the
 * numbers, so each screen that shows one links to its topic here. When a
 * constant in `wizard/`, `plans/`, `weights/` or `foods/nutrient-references`
 * changes, the topic describing it changes with it.
 */
export interface Citation {
  id: CitationId;
  title: string;
  /** Authors or issuing body, then venue and year. */
  source: string;
  url: string;
}

export type CitationId =
  | "mifflin-1990"
  | "fao-energy-2004"
  | "hall-2008"
  | "hall-2011"
  | "nhlbi-obesity-1998"
  | "issn-protein-2017"
  | "morton-2018"
  | "iom-macronutrients-2005"
  | "nih-ods-dri"
  | "who-protein-2007"
  | "iom-water-2005"
  | "nasem-sodium-2019"
  | "who-sugars-2015"
  | "who-fats-2023"
  | "dga-2020"
  | "dga-2010"
  | "fda-caffeine";

export type CitationTopicKey =
  | "energy"
  | "pace"
  | "protein"
  | "macros"
  | "nutrients";

export interface CitationTopic {
  key: CitationTopicKey;
  title: string;
  /** What Macros does with the sources, in plain language. */
  summary: string;
  citations: CitationId[];
}

export const CITATIONS: Record<CitationId, Citation> = {
  "mifflin-1990": {
    id: "mifflin-1990",
    title:
      "A new predictive equation for resting energy expenditure in healthy individuals",
    source:
      "Mifflin MD, St Jeor ST, et al. American Journal of Clinical Nutrition, 1990",
    url: "https://pubmed.ncbi.nlm.nih.gov/2305711/",
  },
  "fao-energy-2004": {
    id: "fao-energy-2004",
    title: "Human energy requirements",
    source: "FAO/WHO/UNU Expert Consultation, 2004",
    url: "https://www.fao.org/4/y5686e/y5686e00.htm",
  },
  "hall-2008": {
    id: "hall-2008",
    title: "What is the required energy deficit per unit weight loss?",
    source: "Hall KD. International Journal of Obesity, 2008",
    url: "https://pubmed.ncbi.nlm.nih.gov/17848938/",
  },
  "hall-2011": {
    id: "hall-2011",
    title: "Quantification of the effect of energy imbalance on bodyweight",
    source: "Hall KD, Sacks G, et al. The Lancet, 2011",
    url: "https://pubmed.ncbi.nlm.nih.gov/21872751/",
  },
  "nhlbi-obesity-1998": {
    id: "nhlbi-obesity-1998",
    title:
      "Clinical Guidelines on the Identification, Evaluation, and Treatment of Overweight and Obesity in Adults",
    source: "National Heart, Lung, and Blood Institute (NIH), 1998",
    url: "https://www.nhlbi.nih.gov/files/docs/guidelines/ob_gdlns.pdf",
  },
  "issn-protein-2017": {
    id: "issn-protein-2017",
    title:
      "International Society of Sports Nutrition Position Stand: protein and exercise",
    source:
      "Jäger R, Kerksick CM, et al. Journal of the International Society of Sports Nutrition, 2017",
    url: "https://pubmed.ncbi.nlm.nih.gov/28642676/",
  },
  "morton-2018": {
    id: "morton-2018",
    title:
      "A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength",
    source:
      "Morton RW, Murphy KT, et al. British Journal of Sports Medicine, 2018",
    url: "https://pubmed.ncbi.nlm.nih.gov/28698222/",
  },
  "iom-macronutrients-2005": {
    id: "iom-macronutrients-2005",
    title:
      "Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids",
    source: "Institute of Medicine, National Academies Press, 2005",
    url: "https://nap.nationalacademies.org/catalog/10490",
  },
  "nih-ods-dri": {
    id: "nih-ods-dri",
    title: "Nutrient Recommendations: Dietary Reference Intakes (DRI)",
    source: "Office of Dietary Supplements, National Institutes of Health",
    url: "https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx",
  },
  "who-protein-2007": {
    id: "who-protein-2007",
    title: "Protein and amino acid requirements in human nutrition",
    source:
      "WHO/FAO/UNU Expert Consultation, WHO Technical Report Series 935, 2007",
    url: "https://iris.who.int/handle/10665/43411",
  },
  "iom-water-2005": {
    id: "iom-water-2005",
    title:
      "Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate",
    source: "Institute of Medicine, National Academies Press, 2005",
    url: "https://nap.nationalacademies.org/catalog/10925",
  },
  "nasem-sodium-2019": {
    id: "nasem-sodium-2019",
    title: "Dietary Reference Intakes for Sodium and Potassium",
    source: "National Academies of Sciences, Engineering, and Medicine, 2019",
    url: "https://nap.nationalacademies.org/catalog/25353",
  },
  "who-sugars-2015": {
    id: "who-sugars-2015",
    title: "Guideline: sugars intake for adults and children",
    source: "World Health Organization, 2015",
    url: "https://www.who.int/publications/i/item/9789241549028",
  },
  "who-fats-2023": {
    id: "who-fats-2023",
    title:
      "Saturated fatty acid and trans-fatty acid intake for adults and children",
    source: "World Health Organization, 2023",
    url: "https://www.who.int/publications/i/item/9789240073630",
  },
  "dga-2020": {
    id: "dga-2020",
    title: "Dietary Guidelines for Americans, 2020–2025",
    source:
      "U.S. Department of Agriculture and Department of Health and Human Services",
    url: "https://www.dietaryguidelines.gov/",
  },
  "dga-2010": {
    id: "dga-2010",
    title: "Dietary Guidelines for Americans, 2010",
    source:
      "U.S. Department of Agriculture and Department of Health and Human Services",
    url: "https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/previous-dietary-guidelines/2010",
  },
  "fda-caffeine": {
    id: "fda-caffeine",
    title: "Spilling the Beans: How Much Caffeine is Too Much?",
    source: "U.S. Food and Drug Administration",
    url: "https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much",
  },
};

export const CITATION_TOPICS: CitationTopic[] = [
  {
    key: "energy",
    title: "Energy expenditure",
    summary:
      "Your starting estimate of what you burn is your resting energy from the Mifflin–St Jeor equation, multiplied by an activity factor from 1.2 (sedentary) to 1.9 (very active). After that, Macros re-estimates it from the food you log and how your weight trend moves, using the energy balance between the two.",
    citations: ["mifflin-1990", "fao-energy-2004", "hall-2011"],
  },
  {
    key: "pace",
    title: "Weight change and pace",
    summary:
      "A pace of weight change is turned into a daily calorie difference at about 7,700 kcal per kilogram of body weight. Targets never go below 1,200 kcal, 80% of your resting energy, or a 25% deficit, and change by at most 150 kcal a week. Losing about 0.5–1 kg a week is the pace clinical guidelines describe as safe for most adults.",
    citations: ["hall-2008", "hall-2011", "nhlbi-obesity-1998"],
  },
  {
    key: "protein",
    title: "Protein",
    summary:
      "Macro profiles set protein between 1.6 and 2.2 g per kg of body weight, the range studied for people who train. Targets never fall below 1.2 g per kg. The general adult reference used for nutrient tracking is 0.8 g per kg.",
    citations: ["issn-protein-2017", "morton-2018", "iom-macronutrients-2005"],
  },
  {
    key: "macros",
    title: "Carbohydrate and fat",
    summary:
      "Fat is set as a share of calories by your macro profile and never below 0.6 g per kg; carbohydrate fills the rest. Protein and carbohydrate count as 4 kcal per gram and fat as 9.",
    citations: ["iom-macronutrients-2005", "dga-2020"],
  },
  {
    key: "nutrients",
    title: "Vitamins, minerals and limits",
    summary:
      "Daily references for vitamins, minerals, water and fiber are the Dietary Reference Intakes for your sex and age (the RDA where one exists, otherwise the Adequate Intake), with fiber at 14 g per 1,000 kcal. Essential amino acids follow the WHO per-kg requirements. Limits: added sugar and saturated fat under 10% of calories, trans fat under 1%, sodium 2,300 mg, cholesterol 300 mg and caffeine 400 mg a day.",
    citations: [
      "nih-ods-dri",
      "iom-macronutrients-2005",
      "iom-water-2005",
      "who-protein-2007",
      "nasem-sodium-2019",
      "who-sugars-2015",
      "who-fats-2023",
      "dga-2020",
      "dga-2010",
      "fda-caffeine",
    ],
  },
];

export const HEALTH_DISCLAIMER =
  "Macros gives estimates for tracking food and weight. It isn’t medical advice. Talk to a doctor or registered dietitian before changing how you eat, especially if you’re pregnant, under 18, or managing a health condition.";
