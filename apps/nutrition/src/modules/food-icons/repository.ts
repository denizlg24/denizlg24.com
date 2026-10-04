import { asc, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { foodIcons } from "../../db/schema";

const foodIconMetadataSelect = {
  key: foodIcons.key,
  foodGroup: foodIcons.foodGroup,
  mediaType: foodIcons.mediaType,
  updatedAt: foodIcons.updatedAt,
};

const foodIconSelect = {
  ...foodIconMetadataSelect,
  imageBase64: foodIcons.imageBase64,
};

export class FoodIconsRepository {
  constructor(private readonly database: Database) {}

  list() {
    return this.database
      .select(foodIconMetadataSelect)
      .from(foodIcons)
      .orderBy(asc(foodIcons.foodGroup), asc(foodIcons.key));
  }

  async findByKey(key: string) {
    const [icon] = await this.database
      .select(foodIconSelect)
      .from(foodIcons)
      .where(eq(foodIcons.key, key))
      .limit(1);

    return icon;
  }
}
