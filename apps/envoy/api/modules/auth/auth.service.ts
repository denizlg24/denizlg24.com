import { generateApiToken, hashApiToken } from "@/lib/crypto";
import {
  fetchGithubUser,
  pollAccessToken,
  requestDeviceCode,
} from "@/lib/github";
import { prisma } from "@/lib/prisma";

export async function startGithubDeviceFlow() {
  return requestDeviceCode();
}

export async function completeGithubDeviceFlow(deviceCode: string) {
  const tokenResponse = await pollAccessToken(deviceCode);

  if ("error" in tokenResponse) {
    return tokenResponse;
  }

  const ghUser = await fetchGithubUser(tokenResponse.access_token);

  const user = await prisma.user.upsert({
    where: { githubId: ghUser.id.toString() },
    update: {
      email: ghUser.email,
    },
    create: {
      githubId: ghUser.id.toString(),
      email: ghUser.email,
    },
  });

  const apiToken = generateApiToken();
  const tokenHash = hashApiToken(apiToken);

  await prisma.apiToken.create({
    data: {
      userId: user.id,
      hash: tokenHash,
    },
  });

  return { apiToken };
}
