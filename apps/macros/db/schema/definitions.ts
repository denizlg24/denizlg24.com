import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const authTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const optionalAuthTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
};

export const nutritionPlanStatusEnum = pgEnum("nutrition_plan_status", [
  "active",
  "pending_acceptance",
  "archived",
]);
export const goalTypeEnum = pgEnum("goal_type", ["lose", "maintain", "gain"]);
export const foodSourceEnum = pgEnum("food_source", [
  "deniz_nutrition",
  "custom",
]);
export const recipeIngredientTypeEnum = pgEnum("recipe_ingredient_type", [
  "food",
  "recipe",
]);
export const recipeStatusEnum = pgEnum("recipe_status", [
  "draft",
  "active",
  "archived",
]);
export const recipeSourceEnum = pgEnum("recipe_source", ["custom"]);
export const mealTypeEnum = pgEnum("meal_type", [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);
export const foodLogEntryTypeEnum = pgEnum("food_log_entry_type", [
  "food",
  "recipe",
  "quick_add",
]);
export const weightGoalStatusEnum = pgEnum("weight_goal_status", [
  "active",
  "archived",
]);
export const weightGoalOutcomeEnum = pgEnum("weight_goal_outcome", [
  "loss",
  "gain",
  "maintain",
]);
export const weighInSourceEnum = pgEnum("weigh_in_source", [
  "manual",
  "import",
]);
export const weighInPhotoAngleEnum = pgEnum("weigh_in_photo_angle", [
  "front",
  "left",
  "right",
  "back",
  "other",
]);
export const expenditureMethodEnum = pgEnum("expenditure_method", [
  "prior",
  "balance",
]);
export const caloriePreferenceEnum = pgEnum("calorie_preference", [
  "consumed",
  "remaining",
]);
export const nutritionProgramModeEnum = pgEnum("nutrition_program_mode", [
  "coached",
  "collaborative",
  "manual",
]);
export const nutritionProgramPhaseEnum = pgEnum("nutrition_program_phase", [
  "cut",
  "maintain",
  "bulk",
  "diet_break",
]);
export const nutritionProgramStatusEnum = pgEnum("nutrition_program_status", [
  "active",
  "paused",
  "completed",
  "archived",
]);
export const nutritionPlanReasonEnum = pgEnum("nutrition_plan_reason", [
  "check_in",
  "program_change",
  "goal_change",
  "diet_break",
  "manual",
  "onboarding",
]);
export const bodyMeasurementSiteEnum = pgEnum("body_measurement_site", [
  "waist",
  "hips",
  "chest",
  "neck",
  "left_arm",
  "right_arm",
  "left_thigh",
  "right_thigh",
  "calf",
  "body_fat",
]);
export const activitySourceEnum = pgEnum("activity_source", [
  "manual",
  "import",
]);
export const healthImportSourceEnum = pgEnum("health_import_source", [
  "apple_shortcuts",
  "health_connect",
  "file",
  "vendor",
]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...authTimestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ...authTimestamps,
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...authTimestamps,
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...optionalAuthTimestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userProfiles = pgTable("user_profiles", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  heightCm: numeric("heightCm", { precision: 5, scale: 2 }),
  birthDate: date("birthDate"),
  sex: text("sex"),
  activityLevel: text("activityLevel"),
  weightUnit: text("weightUnit").notNull().default("kg"),
  energyUnit: text("energyUnit").notNull().default("kcal"),
  caloriePreference: caloriePreferenceEnum("caloriePreference")
    .notNull()
    .default("consumed"),
  onboardingCompletedAt: timestamp("onboardingCompletedAt", {
    withTimezone: true,
  }),
  ...timestamps,
});

export const nutrientDefinitions = pgTable("nutrient_definitions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  group: text("group").notNull(),
  unit: text("unit").notNull(),
  sortOrder: integer("sortOrder").notNull(),
  isDefault: boolean("isDefault").notNull().default(true),
});

export const nutritionPlans = pgTable(
  "nutrition_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    programId: uuid("programId").references(
      (): AnyPgColumn => nutritionPrograms.id,
      { onDelete: "cascade" },
    ),
    name: text("name").notNull(),
    status: nutritionPlanStatusEnum("status").notNull().default("active"),
    goalType: goalTypeEnum("goalType").notNull(),
    startDate: date("startDate").notNull(),
    endDate: date("endDate"),
    effectiveFrom: date("effectiveFrom"),
    effectiveTo: date("effectiveTo"),
    reason: nutritionPlanReasonEnum("reason").notNull().default("onboarding"),
    tdeeAtIssue: numeric("tdeeAtIssue", { precision: 8, scale: 2 }),
    tdeeVarianceAtIssue: numeric("tdeeVarianceAtIssue", {
      precision: 14,
      scale: 2,
    }),
    deltaFromPreviousCalories: numeric("deltaFromPreviousCalories", {
      precision: 8,
      scale: 2,
    }),
    calorieTarget: numeric("calorieTarget", { precision: 8, scale: 2 }),
    proteinTarget: numeric("proteinTarget", { precision: 8, scale: 2 }),
    carbsTarget: numeric("carbsTarget", { precision: 8, scale: 2 }),
    fatTarget: numeric("fatTarget", { precision: 8, scale: 2 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nutrition_plans_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("nutrition_plans_program_effective_idx").on(
      table.programId,
      table.effectiveFrom.desc(),
    ),
  ],
);

export const nutritionPlanDays = pgTable(
  "nutrition_plan_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("planId")
      .notNull()
      .references(() => nutritionPlans.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    calorieTarget: numeric("calorieTarget", { precision: 8, scale: 2 }),
    proteinTarget: numeric("proteinTarget", { precision: 8, scale: 2 }),
    carbsTarget: numeric("carbsTarget", { precision: 8, scale: 2 }),
    fatTarget: numeric("fatTarget", { precision: 8, scale: 2 }),
    ...timestamps,
  },
  (table) => [
    unique("nutrition_plan_days_plan_weekday_unique").on(
      table.planId,
      table.weekday,
    ),
    check(
      "nutrition_plan_days_weekday_range",
      sql`${table.weekday} between 0 and 6`,
    ),
  ],
);

export const nutrientTargets = pgTable(
  "nutrient_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("planId")
      .notNull()
      .references(() => nutritionPlans.id, { onDelete: "cascade" }),
    nutrientKey: text("nutrientKey")
      .notNull()
      .references(() => nutrientDefinitions.key),
    targetValue: numeric("targetValue", { precision: 12, scale: 4 }).notNull(),
    minValue: numeric("minValue", { precision: 12, scale: 4 }),
    maxValue: numeric("maxValue", { precision: 12, scale: 4 }),
  },
  (table) => [
    unique("nutrient_targets_plan_nutrient_unique").on(
      table.planId,
      table.nutrientKey,
    ),
  ],
);

export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("ownerUserId").references(() => user.id, {
      onDelete: "cascade",
    }),
    source: foodSourceEnum("source").notNull(),
    externalItemId: uuid("externalItemId"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    brand: text("brand"),
    iconKey: text("iconKey").notNull().default("other-001"),
    ...timestamps,
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("foods_source_external_item_id_unique")
      .on(table.source, table.externalItemId)
      .where(sql`${table.externalItemId} is not null`),
    index("foods_barcode_idx").on(table.barcode),
    index("foods_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const userCustomFoods = pgTable(
  "user_custom_foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    foodId: uuid("foodId")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    ...timestamps,
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  (table) => [
    unique("user_custom_foods_user_food_unique").on(table.userId, table.foodId),
    index("user_custom_foods_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("user_custom_foods_food_id_idx").on(table.foodId),
  ],
);

export const foodNutritionSnapshots = pgTable(
  "food_nutrition_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    foodId: uuid("foodId")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    sourceItemId: uuid("sourceItemId"),
    servingLabel: text("servingLabel").notNull(),
    servingQuantity: numeric("servingQuantity", {
      precision: 12,
      scale: 4,
    }).notNull(),
    servingUnit: text("servingUnit").notNull(),
    rawSummary: jsonb("rawSummary"),
    rawNutrition: jsonb("rawNutrition"),
    fetchedAt: timestamp("fetchedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("food_snapshots_food_fetched_idx").on(
      table.foodId,
      table.fetchedAt.desc(),
    ),
  ],
);

export const foodNutrientValues = pgTable(
  "food_nutrient_values",
  {
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => foodNutritionSnapshots.id, { onDelete: "cascade" }),
    nutrientKey: text("nutrientKey")
      .notNull()
      .references(() => nutrientDefinitions.key),
    amount: numeric("amount", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.nutrientKey] })],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    servings: numeric("servings", { precision: 12, scale: 4 })
      .notNull()
      .default("1"),
    servingLabel: text("servingLabel").notNull().default("serving"),
    prepTimeMinutes: integer("prepTimeMinutes"),
    cookTimeMinutes: integer("cookTimeMinutes"),
    source: recipeSourceEnum("source").notNull().default("custom"),
    status: recipeStatusEnum("status").notNull().default("active"),
    ...timestamps,
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  (table) => [
    index("recipes_user_status_idx").on(table.userId, table.status),
    index("recipes_user_name_idx").on(table.userId, table.name),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    ingredientType: recipeIngredientTypeEnum("ingredientType").notNull(),
    foodId: uuid("foodId").references(() => foods.id, { onDelete: "restrict" }),
    foodSnapshotId: uuid("foodSnapshotId").references(
      () => foodNutritionSnapshots.id,
      {
        onDelete: "restrict",
      },
    ),
    childRecipeId: uuid("childRecipeId").references(() => recipes.id, {
      onDelete: "restrict",
    }),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    unit: text("unit").notNull(),
    servings: numeric("servings", { precision: 12, scale: 4 }),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("recipe_ingredients_recipe_position_idx").on(
      table.recipeId,
      table.position,
    ),
    index("recipe_ingredients_food_id_idx").on(table.foodId),
    index("recipe_ingredients_child_recipe_id_idx").on(table.childRecipeId),
    check(
      "recipe_ingredients_type_links_check",
      sql`(
        (${table.ingredientType} = 'food' and ${table.foodId} is not null and ${table.foodSnapshotId} is not null and ${table.childRecipeId} is null)
        or
        (${table.ingredientType} = 'recipe' and ${table.childRecipeId} is not null and ${table.foodId} is null and ${table.foodSnapshotId} is null)
      )`,
    ),
    check(
      "recipe_ingredients_quantity_positive_check",
      sql`${table.quantity} > 0`,
    ),
    check(
      "recipe_ingredients_servings_positive_check",
      sql`${table.servings} is null or ${table.servings} > 0`,
    ),
  ],
);

export const recipeNutritionSnapshots = pgTable(
  "recipe_nutrition_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipeId")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    servings: numeric("servings", { precision: 12, scale: 4 }).notNull(),
    servingLabel: text("servingLabel").notNull(),
    totalWeightGrams: numeric("totalWeightGrams", { precision: 12, scale: 4 }),
    caloriesPerServing: numeric("caloriesPerServing", {
      precision: 12,
      scale: 4,
    })
      .notNull()
      .default("0"),
    proteinPerServing: numeric("proteinPerServing", {
      precision: 12,
      scale: 4,
    })
      .notNull()
      .default("0"),
    carbsPerServing: numeric("carbsPerServing", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    fatPerServing: numeric("fatPerServing", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    nutrientsPerServing: jsonb("nutrientsPerServing")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recipe_snapshots_recipe_created_idx").on(
      table.recipeId,
      table.createdAt.desc(),
    ),
  ],
);

export const recipeSnapshotNutrients = pgTable(
  "recipe_snapshot_nutrients",
  {
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => recipeNutritionSnapshots.id, { onDelete: "cascade" }),
    nutrientKey: text("nutrientKey")
      .notNull()
      .references(() => nutrientDefinitions.key),
    amountPerServing: numeric("amountPerServing", {
      precision: 12,
      scale: 4,
    })
      .notNull()
      .default("0"),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.nutrientKey] })],
);

export const foodFavorites = pgTable(
  "food_favorites",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    foodId: uuid("foodId")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => foodNutritionSnapshots.id, { onDelete: "restrict" }),
    defaultServings: numeric("defaultServings", {
      precision: 12,
      scale: 4,
    })
      .notNull()
      .default("1"),
    defaultMealType: mealTypeEnum("defaultMealType"),
    sortOrder: integer("sortOrder").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.foodId] }),
    index("food_favorites_user_sort_idx").on(table.userId, table.sortOrder),
  ],
);

export const foodServingPreferences = pgTable(
  "food_serving_preferences",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    foodId: uuid("foodId")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshotId")
      .notNull()
      .references(() => foodNutritionSnapshots.id, { onDelete: "restrict" }),
    servings: numeric("servings", { precision: 12, scale: 4 }).notNull(),
    mealType: mealTypeEnum("mealType"),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.foodId] })],
);

export const mealTemplates = pgTable(
  "meal_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultMealType: mealTypeEnum("defaultMealType"),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("meal_templates_user_name_idx").on(table.userId, table.name),
  ],
);

export const mealTemplateItems = pgTable(
  "meal_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("templateId")
      .notNull()
      .references(() => mealTemplates.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    entryType: foodLogEntryTypeEnum("entryType").notNull(),
    foodId: uuid("foodId").references(() => foods.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshotId").references(() => foodNutritionSnapshots.id, {
      onDelete: "restrict",
    }),
    recipeId: uuid("recipeId").references(() => recipes.id, {
      onDelete: "restrict",
    }),
    recipeSnapshotId: uuid("recipeSnapshotId").references(
      () => recipeNutritionSnapshots.id,
      { onDelete: "restrict" },
    ),
    servings: numeric("servings", { precision: 12, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("meal_template_items_template_position_idx").on(
      table.templateId,
      table.position,
    ),
    check(
      "meal_template_items_type_links_check",
      sql`(
        (${table.entryType} = 'food' and ${table.foodId} is not null and ${table.snapshotId} is not null and ${table.recipeId} is null and ${table.recipeSnapshotId} is null)
        or
        (${table.entryType} = 'recipe' and ${table.recipeId} is not null and ${table.recipeSnapshotId} is not null and ${table.foodId} is null and ${table.snapshotId} is null)
      )`,
    ),
  ],
);

export const foodLogEntries = pgTable(
  "food_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: uuid("clientMutationId"),
    logDate: date("logDate").notNull(),
    timezoneAtLog: text("timezoneAtLog").notNull().default("UTC"),
    eatenAt: timestamp("eatenAt", { withTimezone: true }),
    mealType: mealTypeEnum("mealType").notNull().default("snack"),
    entryType: foodLogEntryTypeEnum("entryType").notNull().default("food"),
    foodId: uuid("foodId").references(() => foods.id, { onDelete: "set null" }),
    snapshotId: uuid("snapshotId").references(() => foodNutritionSnapshots.id, {
      onDelete: "set null",
    }),
    recipeId: uuid("recipeId").references(() => recipes.id, {
      onDelete: "set null",
    }),
    recipeSnapshotId: uuid("recipeSnapshotId").references(
      () => recipeNutritionSnapshots.id,
      {
        onDelete: "set null",
      },
    ),
    foodName: text("foodName").notNull(),
    brand: text("brand"),
    servingLabel: text("servingLabel"),
    servingQuantity: numeric("servingQuantity", {
      precision: 12,
      scale: 4,
    }).notNull(),
    servingUnit: text("servingUnit").notNull(),
    servingsConsumed: numeric("servingsConsumed", {
      precision: 12,
      scale: 4,
    }).notNull(),
    // What the owner actually typed. servingsConsumed is a multiplier, so
    // "1.5 servings" and "150 g" of a 100 g serving are indistinguishable
    // without recording the measure that was entered.
    enteredQuantity: numeric("enteredQuantity", { precision: 12, scale: 4 }),
    enteredUnit: text("enteredUnit"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("food_log_entries_user_log_date_idx").on(table.userId, table.logDate),
    index("food_log_entries_user_eaten_at_idx").on(table.userId, table.eatenAt),
    index("food_log_entries_user_type_eaten_at_idx").on(
      table.userId,
      table.entryType,
      table.eatenAt.desc(),
    ),
    index("food_log_entries_user_food_eaten_at_idx").on(
      table.userId,
      table.foodId,
      table.eatenAt.desc(),
    ),
    index("food_log_entries_food_id_idx").on(table.foodId),
    index("food_log_entries_recipe_id_idx").on(table.recipeId),
    uniqueIndex("food_log_entries_user_client_mutation_unique")
      .on(table.userId, table.clientMutationId)
      .where(sql`${table.clientMutationId} is not null`),
    check(
      "food_log_entries_type_links_check",
      sql`(
        (${table.entryType} = 'food' and ${table.foodId} is not null and ${table.snapshotId} is not null)
        or
        (${table.entryType} = 'recipe' and ${table.recipeId} is not null and ${table.recipeSnapshotId} is not null)
        or
        (${table.entryType} = 'quick_add' and ${table.foodId} is null and ${table.snapshotId} is null and ${table.recipeId} is null and ${table.recipeSnapshotId} is null)
      )`,
    ),
  ],
);

export const foodLogEntryNutrients = pgTable(
  "food_log_entry_nutrients",
  {
    entryId: uuid("entryId")
      .notNull()
      .references(() => foodLogEntries.id, { onDelete: "cascade" }),
    nutrientKey: text("nutrientKey")
      .notNull()
      .references(() => nutrientDefinitions.key),
    amount: numeric("amount", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.nutrientKey] })],
);

export const dailyNutritionSummaries = pgTable(
  "daily_nutrition_summaries",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    nutrients: jsonb("nutrients").notNull().default(sql`'{}'::jsonb`),
    calories: numeric("calories", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    protein: numeric("protein", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    carbs: numeric("carbs", { precision: 12, scale: 4 }).notNull().default("0"),
    fat: numeric("fat", { precision: 12, scale: 4 }).notNull().default("0"),
    entryCount: integer("entryCount").notNull().default(0),
    mealCount: integer("mealCount").notNull().default(0),
    loggingCompleteness: numeric("loggingCompleteness", {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default("0"),
    micronutrientCoverage: numeric("micronutrientCoverage", {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.logDate] })],
);

export const userDayRolloverStates = pgTable("user_day_rollover_states", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lastFinalizedLogDate: date("lastFinalizedLogDate"),
  lastRunAt: timestamp("lastRunAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const weightGoals = pgTable(
  "weight_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: weightGoalStatusEnum("status").notNull().default("active"),
    goalType: goalTypeEnum("goalType").notNull(),
    startDate: date("startDate").notNull(),
    startWeightKg: numeric("startWeightKg", { precision: 7, scale: 3 }),
    targetWeightKg: numeric("targetWeightKg", { precision: 7, scale: 3 }),
    targetDate: date("targetDate"),
    weeklyRateKg: numeric("weeklyRateKg", { precision: 6, scale: 3 }),
    closedAt: timestamp("closedAt", { withTimezone: true }),
    endWeightKg: numeric("endWeightKg", { precision: 7, scale: 3 }),
    outcome: weightGoalOutcomeEnum("outcome"),
    achieved: boolean("achieved"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("weight_goals_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("weight_goals_user_start_idx").on(
      table.userId,
      table.startDate.desc(),
    ),
  ],
);

export const nutritionPrograms = pgTable(
  "nutrition_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeWeightGoalId: uuid("activeWeightGoalId").references(
      () => weightGoals.id,
      { onDelete: "set null" },
    ),
    goalType: goalTypeEnum("goalType").notNull(),
    proteinGramsPerKg: numeric("proteinGramsPerKg", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("1.6"),
    fatGramsPerKg: numeric("fatGramsPerKg", { precision: 5, scale: 2 }),
    fatPercent: numeric("fatPercent", { precision: 5, scale: 2 }),
    distributionProfile: text("distributionProfile")
      .notNull()
      .default("balanced"),
    calorieCycling: jsonb("calorieCycling").notNull().default(sql`'{}'::jsonb`),
    checkInWeekday: integer("checkInWeekday").notNull().default(1),
    mode: nutritionProgramModeEnum("mode").notNull().default("coached"),
    dietPhase: nutritionProgramPhaseEnum("dietPhase")
      .notNull()
      .default("maintain"),
    manualCalorieTarget: numeric("manualCalorieTarget", {
      precision: 8,
      scale: 2,
    }),
    status: nutritionProgramStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nutrition_programs_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    check(
      "nutrition_programs_check_in_weekday_range",
      sql`${table.checkInWeekday} between 0 and 6`,
    ),
  ],
);

export const weighIns = pgTable(
  "weigh_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    timezoneAtLog: text("timezoneAtLog").notNull().default("UTC"),
    measuredAt: timestamp("measuredAt", { withTimezone: true }).notNull(),
    weightKg: numeric("weightKg", { precision: 7, scale: 3 }).notNull(),
    bodyFatPct: numeric("bodyFatPct", { precision: 5, scale: 2 }),
    source: weighInSourceEnum("source").notNull().default("manual"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    unique("weigh_ins_user_log_date_unique").on(table.userId, table.logDate),
    index("weigh_ins_user_measured_at_idx").on(
      table.userId,
      table.measuredAt.desc(),
    ),
  ],
);

export const weightTrendPoints = pgTable(
  "weight_trend_points",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    trendWeightKg: numeric("trendWeightKg", {
      precision: 7,
      scale: 3,
    }).notNull(),
    scaleWeightKg: numeric("scaleWeightKg", { precision: 7, scale: 3 }),
    trendVarianceKg2: numeric("trendVarianceKg2", {
      precision: 10,
      scale: 6,
    }).notNull(),
    slopeKgPerWeek: numeric("slopeKgPerWeek", {
      precision: 8,
      scale: 5,
    }),
    hasObservation: boolean("hasObservation").notNull(),
    algorithmVersion: text("algorithmVersion").notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.logDate] })],
);

export const weighInPhotos = pgTable(
  "weigh_in_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weighInId: uuid("weighInId")
      .notNull()
      .references(() => weighIns.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    angle: weighInPhotoAngleEnum("angle").notNull(),
    objectUrl: text("objectUrl").notNull(),
    storageKey: text("storageKey").notNull(),
    mimeType: text("mimeType"),
    byteSize: integer("byteSize"),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    capturedAt: timestamp("capturedAt", { withTimezone: true }),
    uploadedAt: timestamp("uploadedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("weigh_in_photos_weigh_in_angle_storage_key_unique").on(
      table.weighInId,
      table.angle,
      table.storageKey,
    ),
    index("weigh_in_photos_user_uploaded_at_idx").on(
      table.userId,
      table.uploadedAt.desc(),
    ),
    index("weigh_in_photos_weigh_in_id_idx").on(table.weighInId),
  ],
);

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    site: bodyMeasurementSiteEnum("site").notNull(),
    value: numeric("value", { precision: 8, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("cm"),
    source: activitySourceEnum("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    unique("body_measurements_user_date_site_unique").on(
      table.userId,
      table.logDate,
      table.site,
    ),
    index("body_measurements_user_site_date_idx").on(
      table.userId,
      table.site,
      table.logDate.desc(),
    ),
  ],
);

export const dailyActivity = pgTable(
  "daily_activity",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    steps: integer("steps"),
    activeEnergyKcal: numeric("activeEnergyKcal", { precision: 9, scale: 2 }),
    source: activitySourceEnum("source").notNull().default("manual"),
    sourceId: text("sourceId"),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.logDate, table.source] }),
    check(
      "daily_activity_steps_nonnegative",
      sql`${table.steps} is null or ${table.steps} >= 0`,
    ),
  ],
);

export const hydrationLogs = pgTable(
  "hydration_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    volume: numeric("volume", { precision: 9, scale: 2 }).notNull(),
    unit: text("unit").notNull().default("ml"),
    loggedAt: timestamp("loggedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: activitySourceEnum("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    index("hydration_logs_user_date_idx").on(table.userId, table.logDate),
  ],
);

export const habitDefinitions = pgTable(
  "habit_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetPerWeek: integer("targetPerWeek").notNull().default(7),
    isBuiltin: boolean("isBuiltin").notNull().default(false),
    builtinKey: text("builtinKey"),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("habit_definitions_user_active_idx").on(
      table.userId,
      table.archivedAt,
    ),
    check(
      "habit_definitions_target_range",
      sql`${table.targetPerWeek} between 1 and 7`,
    ),
  ],
);

export const habitCompletions = pgTable(
  "habit_completions",
  {
    habitId: uuid("habitId")
      .notNull()
      .references(() => habitDefinitions.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.habitId, table.logDate] }),
    index("habit_completions_user_date_idx").on(table.userId, table.logDate),
  ],
);

export const healthImportTokens = pgTable(
  "health_import_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),
    source: healthImportSourceEnum("source").notNull(),
    label: text("label").notNull(),
    lastUsedAt: timestamp("lastUsedAt", { withTimezone: true }),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("health_import_tokens_user_idx").on(table.userId)],
);

export const energyExpenditureEstimates = pgTable(
  "energy_expenditure_estimates",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    logDate: date("logDate").notNull(),
    estimatedTdee: numeric("estimatedTdee", {
      precision: 8,
      scale: 2,
    }).notNull(),
    varianceKcal2: numeric("varianceKcal2", {
      precision: 14,
      scale: 2,
    }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    method: expenditureMethodEnum("method").notNull().default("prior"),
    loggingCompleteness: numeric("loggingCompleteness", {
      precision: 5,
      scale: 4,
    }).notNull(),
    algorithmVersion: text("algorithmVersion").notNull(),
    inputs: jsonb("inputs").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.logDate] })],
);

export const nutrientDefinitionSeed = [
  "calories",
  "water",
  "alcohol",
  "caffeine",
  "cholesterol",
  "choline",
  "carbs",
  "fiber",
  "sugar",
  "addedSugar",
  "polyols",
  "fat",
  "monoUnsaturated",
  "polyUnsaturated",
  "omega3",
  "omega3Ala",
  "omega3Dha",
  "omega3Epa",
  "omega6",
  "saturated",
  "transFat",
  "protein",
  "cysteine",
  "histidine",
  "isoleucine",
  "leucine",
  "lysine",
  "methionine",
  "phenylalanine",
  "threonine",
  "tryptophan",
  "tyrosine",
  "valine",
  "a",
  "b1",
  "b2",
  "b3",
  "b5",
  "b6",
  "b12",
  "c",
  "d",
  "e",
  "k",
  "folate",
  "calcium",
  "copper",
  "iron",
  "magnesium",
  "manganese",
  "phosphorus",
  "potassium",
  "selenium",
  "sodium",
  "zinc",
] as const;

export const userRelations = relations(user, ({ many, one }) => ({
  accounts: many(account),
  sessions: many(session),
  profile: one(userProfiles),
  nutritionPlans: many(nutritionPlans),
  foods: many(foods),
  customFoods: many(userCustomFoods),
  recipes: many(recipes),
  foodLogEntries: many(foodLogEntries),
  weightGoals: many(weightGoals),
  weighIns: many(weighIns),
  weightTrendPoints: many(weightTrendPoints),
  weighInPhotos: many(weighInPhotos),
  energyExpenditureEstimates: many(energyExpenditureEstimates),
  dayRolloverState: one(userDayRolloverStates),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const userProfileRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, { fields: [userProfiles.userId], references: [user.id] }),
}));

export const nutritionPlanRelations = relations(
  nutritionPlans,
  ({ many, one }) => ({
    user: one(user, { fields: [nutritionPlans.userId], references: [user.id] }),
    nutrientTargets: many(nutrientTargets),
    days: many(nutritionPlanDays),
  }),
);

export const nutritionPlanDayRelations = relations(
  nutritionPlanDays,
  ({ one }) => ({
    plan: one(nutritionPlans, {
      fields: [nutritionPlanDays.planId],
      references: [nutritionPlans.id],
    }),
  }),
);

export const nutrientTargetRelations = relations(
  nutrientTargets,
  ({ one }) => ({
    plan: one(nutritionPlans, {
      fields: [nutrientTargets.planId],
      references: [nutritionPlans.id],
    }),
    nutrient: one(nutrientDefinitions, {
      fields: [nutrientTargets.nutrientKey],
      references: [nutrientDefinitions.key],
    }),
  }),
);

export const foodRelations = relations(foods, ({ many, one }) => ({
  owner: one(user, { fields: [foods.ownerUserId], references: [user.id] }),
  customFoodOwners: many(userCustomFoods),
  snapshots: many(foodNutritionSnapshots),
  logEntries: many(foodLogEntries),
  recipeIngredients: many(recipeIngredients),
}));

export const userCustomFoodRelations = relations(
  userCustomFoods,
  ({ one }) => ({
    user: one(user, {
      fields: [userCustomFoods.userId],
      references: [user.id],
    }),
    food: one(foods, {
      fields: [userCustomFoods.foodId],
      references: [foods.id],
    }),
  }),
);

export const foodNutritionSnapshotRelations = relations(
  foodNutritionSnapshots,
  ({ many, one }) => ({
    food: one(foods, {
      fields: [foodNutritionSnapshots.foodId],
      references: [foods.id],
    }),
    nutrients: many(foodNutrientValues),
    recipeIngredients: many(recipeIngredients),
    logEntries: many(foodLogEntries),
  }),
);

export const foodNutrientValueRelations = relations(
  foodNutrientValues,
  ({ one }) => ({
    snapshot: one(foodNutritionSnapshots, {
      fields: [foodNutrientValues.snapshotId],
      references: [foodNutritionSnapshots.id],
    }),
    nutrient: one(nutrientDefinitions, {
      fields: [foodNutrientValues.nutrientKey],
      references: [nutrientDefinitions.key],
    }),
  }),
);

export const recipeRelations = relations(recipes, ({ many, one }) => ({
  user: one(user, { fields: [recipes.userId], references: [user.id] }),
  ingredients: many(recipeIngredients, { relationName: "recipeIngredients" }),
  parentIngredients: many(recipeIngredients, {
    relationName: "childRecipeIngredients",
  }),
  snapshots: many(recipeNutritionSnapshots),
  logEntries: many(foodLogEntries),
}));

export const recipeIngredientRelations = relations(
  recipeIngredients,
  ({ one }) => ({
    recipe: one(recipes, {
      fields: [recipeIngredients.recipeId],
      references: [recipes.id],
      relationName: "recipeIngredients",
    }),
    food: one(foods, {
      fields: [recipeIngredients.foodId],
      references: [foods.id],
    }),
    foodSnapshot: one(foodNutritionSnapshots, {
      fields: [recipeIngredients.foodSnapshotId],
      references: [foodNutritionSnapshots.id],
    }),
    childRecipe: one(recipes, {
      fields: [recipeIngredients.childRecipeId],
      references: [recipes.id],
      relationName: "childRecipeIngredients",
    }),
  }),
);

export const recipeNutritionSnapshotRelations = relations(
  recipeNutritionSnapshots,
  ({ many, one }) => ({
    recipe: one(recipes, {
      fields: [recipeNutritionSnapshots.recipeId],
      references: [recipes.id],
    }),
    nutrients: many(recipeSnapshotNutrients),
    logEntries: many(foodLogEntries),
  }),
);

export const recipeSnapshotNutrientRelations = relations(
  recipeSnapshotNutrients,
  ({ one }) => ({
    snapshot: one(recipeNutritionSnapshots, {
      fields: [recipeSnapshotNutrients.snapshotId],
      references: [recipeNutritionSnapshots.id],
    }),
    nutrient: one(nutrientDefinitions, {
      fields: [recipeSnapshotNutrients.nutrientKey],
      references: [nutrientDefinitions.key],
    }),
  }),
);

export const foodLogEntryRelations = relations(
  foodLogEntries,
  ({ many, one }) => ({
    user: one(user, { fields: [foodLogEntries.userId], references: [user.id] }),
    food: one(foods, {
      fields: [foodLogEntries.foodId],
      references: [foods.id],
    }),
    snapshot: one(foodNutritionSnapshots, {
      fields: [foodLogEntries.snapshotId],
      references: [foodNutritionSnapshots.id],
    }),
    recipe: one(recipes, {
      fields: [foodLogEntries.recipeId],
      references: [recipes.id],
    }),
    recipeSnapshot: one(recipeNutritionSnapshots, {
      fields: [foodLogEntries.recipeSnapshotId],
      references: [recipeNutritionSnapshots.id],
    }),
    nutrients: many(foodLogEntryNutrients),
  }),
);

export const foodLogEntryNutrientRelations = relations(
  foodLogEntryNutrients,
  ({ one }) => ({
    entry: one(foodLogEntries, {
      fields: [foodLogEntryNutrients.entryId],
      references: [foodLogEntries.id],
    }),
    nutrient: one(nutrientDefinitions, {
      fields: [foodLogEntryNutrients.nutrientKey],
      references: [nutrientDefinitions.key],
    }),
  }),
);

export const dailyNutritionSummaryRelations = relations(
  dailyNutritionSummaries,
  ({ one }) => ({
    user: one(user, {
      fields: [dailyNutritionSummaries.userId],
      references: [user.id],
    }),
  }),
);

export const userDayRolloverStateRelations = relations(
  userDayRolloverStates,
  ({ one }) => ({
    user: one(user, {
      fields: [userDayRolloverStates.userId],
      references: [user.id],
    }),
  }),
);

export const weightGoalRelations = relations(weightGoals, ({ one }) => ({
  user: one(user, { fields: [weightGoals.userId], references: [user.id] }),
}));

export const weighInRelations = relations(weighIns, ({ many, one }) => ({
  user: one(user, { fields: [weighIns.userId], references: [user.id] }),
  photos: many(weighInPhotos),
}));

export const weightTrendPointRelations = relations(
  weightTrendPoints,
  ({ one }) => ({
    user: one(user, {
      fields: [weightTrendPoints.userId],
      references: [user.id],
    }),
  }),
);

export const weighInPhotoRelations = relations(weighInPhotos, ({ one }) => ({
  user: one(user, { fields: [weighInPhotos.userId], references: [user.id] }),
  weighIn: one(weighIns, {
    fields: [weighInPhotos.weighInId],
    references: [weighIns.id],
  }),
}));

export const energyExpenditureEstimateRelations = relations(
  energyExpenditureEstimates,
  ({ one }) => ({
    user: one(user, {
      fields: [energyExpenditureEstimates.userId],
      references: [user.id],
    }),
  }),
);

export const schema = {
  user,
  session,
  account,
  verification,
  userProfiles,
  nutrientDefinitions,
  nutritionPlans,
  nutritionPrograms,
  nutritionPlanDays,
  nutrientTargets,
  foods,
  userCustomFoods,
  foodNutritionSnapshots,
  foodNutrientValues,
  recipes,
  recipeIngredients,
  recipeNutritionSnapshots,
  recipeSnapshotNutrients,
  foodFavorites,
  foodServingPreferences,
  mealTemplates,
  mealTemplateItems,
  foodLogEntries,
  foodLogEntryNutrients,
  dailyNutritionSummaries,
  userDayRolloverStates,
  weightGoals,
  weighIns,
  weightTrendPoints,
  weighInPhotos,
  energyExpenditureEstimates,
  bodyMeasurements,
  dailyActivity,
  hydrationLogs,
  habitDefinitions,
  habitCompletions,
  healthImportTokens,
  userRelations,
  sessionRelations,
  accountRelations,
  userProfileRelations,
  nutritionPlanRelations,
  nutritionPlanDayRelations,
  nutrientTargetRelations,
  foodRelations,
  userCustomFoodRelations,
  foodNutritionSnapshotRelations,
  foodNutrientValueRelations,
  recipeRelations,
  recipeIngredientRelations,
  recipeNutritionSnapshotRelations,
  recipeSnapshotNutrientRelations,
  foodLogEntryRelations,
  foodLogEntryNutrientRelations,
  dailyNutritionSummaryRelations,
  userDayRolloverStateRelations,
  weightGoalRelations,
  weighInRelations,
  weightTrendPointRelations,
  weighInPhotoRelations,
  energyExpenditureEstimateRelations,
};
