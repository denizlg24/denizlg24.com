import { prisma } from "@/lib/prisma";
import {
  blobKey,
  commitKey,
  getDownloadUrl,
  getUploadUrl,
  manifestKey,
  objectExists,
} from "@/lib/storage";
import { authorizeBlobPolicyUpdate, canDownloadBlob } from "./blobs.policy";

export class BlobAccessDeniedError extends Error {}

function storageKey(
  type: "blob" | "manifest" | "commit",
  userId: string,
  projectId: string,
  hash: string,
) {
  return type === "manifest"
    ? manifestKey(userId, projectId, hash)
    : type === "commit"
      ? commitKey(userId, projectId, hash)
      : blobKey(userId, projectId, hash);
}

export async function getUploadSignedUrl(
  userId: string,
  projectId: string,
  hash: string,
  type: "blob" | "manifest" | "commit",
) {
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });

  if (!membership) {
    throw new Error("Not authorized");
  }

  const owner = await prisma.projectMember.findFirst({
    where: { projectId, role: "owner" },
    select: { userId: true },
  });

  if (!owner) {
    throw new Error("Project owner not found");
  }

  const key = storageKey(type, owner.userId, projectId, hash);

  return getUploadUrl(key);
}

export async function getDownloadSignedUrl(
  userId: string,
  projectId: string,
  hash: string,
  type: "blob" | "manifest" | "commit",
) {
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });

  if (!membership) {
    throw new Error("Not authorized");
  }

  const owner = await prisma.projectMember.findFirst({
    where: { projectId, role: "owner" },
    select: { userId: true },
  });

  if (!owner) {
    throw new Error("Project owner not found");
  }

  if (type === "blob" && owner.userId !== userId) {
    const policy = await prisma.blobAccessPolicy.findUnique({
      where: {
        projectId_blobHash: { projectId, blobHash: hash },
      },
      select: {
        grants: {
          where: { userId },
          select: { userId: true },
          take: 1,
        },
      },
    });

    if (
      !canDownloadBlob({
        isOwner: false,
        hasPolicy: Boolean(policy),
        hasGrant: Boolean(policy?.grants.length),
      })
    ) {
      throw new BlobAccessDeniedError();
    }
  }

  const ownerKey = storageKey(type, owner.userId, projectId, hash);
  const requesterKey = storageKey(type, userId, projectId, hash);
  if ((await objectExists(ownerKey)) || owner.userId === userId) {
    return getDownloadUrl(ownerKey);
  }

  if (await objectExists(requesterKey)) {
    return getDownloadUrl(requesterKey);
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });

  for (const member of members) {
    if (member.userId === owner.userId || member.userId === userId) {
      continue;
    }

    const memberKey = storageKey(type, member.userId, projectId, hash);
    if (await objectExists(memberKey)) {
      return getDownloadUrl(memberKey);
    }
  }

  return getDownloadUrl(ownerKey);
}

export async function replaceBlobAccess({
  requestingUserId,
  projectId,
  blobHash,
  memberIds,
}: {
  requestingUserId: string;
  projectId: string;
  blobHash: string;
  memberIds: string[] | null;
}) {
  const [membership, existingPolicy] = await Promise.all([
    prisma.projectMember.findUnique({
      where: {
        userId_projectId: { userId: requestingUserId, projectId },
      },
      select: { role: true },
    }),
    prisma.blobAccessPolicy.findUnique({
      where: { projectId_blobHash: { projectId, blobHash } },
      select: { projectId: true },
    }),
  ]);

  const decision = authorizeBlobPolicyUpdate({
    requesterRole: membership?.role ?? null,
    hasExistingPolicy: Boolean(existingPolicy),
    memberIds,
  });
  if (!decision.allowed) {
    throw new BlobAccessDeniedError(decision.reason);
  }

  if (memberIds === null) {
    await prisma.blobAccessPolicy.deleteMany({
      where: { projectId, blobHash },
    });
    return { projectId, blobHash, grants: [] };
  }

  const uniqueMemberIds = [...new Set(memberIds)];
  const validMembers = await prisma.projectMember.count({
    where: {
      projectId,
      role: { not: "owner" },
      userId: { in: uniqueMemberIds },
    },
  });
  if (validMembers !== uniqueMemberIds.length) {
    throw new TypeError("Every grant must reference a project member");
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.blobAccessPolicy.deleteMany({
      where: { projectId, blobHash },
    });

    return transaction.blobAccessPolicy.create({
      data: {
        projectId,
        blobHash,
        grants: {
          create: uniqueMemberIds.map((userId) => ({ userId })),
        },
      },
      select: {
        projectId: true,
        blobHash: true,
        grants: { select: { userId: true } },
      },
    });
  });
}
