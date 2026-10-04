import { db } from "../../db/client";
import { hashApiKey, readApiKeyFromRequest } from "./keys";
import { ApiKeysRepository } from "./repository";

const repository = new ApiKeysRepository(db);

export const hasValidApiKey = async (request: Request) => {
  const apiKey = readApiKeyFromRequest(request);

  if (!apiKey) {
    return false;
  }

  const storedKey = await repository.findActiveByHash(hashApiKey(apiKey));

  if (!storedKey) {
    return false;
  }

  await repository.markUsed(storedKey.id);
  return true;
};
