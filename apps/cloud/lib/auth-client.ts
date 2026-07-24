import { createCloudAuthClient } from "@repo/cloud-auth-client";
import { API_BASE_URL } from "./env";

export const authClient = createCloudAuthClient({ baseURL: API_BASE_URL });
