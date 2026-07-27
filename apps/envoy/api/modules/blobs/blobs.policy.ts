export interface BlobPolicyUpdate {
  requesterRole: string | null;
  hasExistingPolicy: boolean;
  memberIds: string[] | null;
}

export type BlobPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export function authorizeBlobPolicyUpdate({
  requesterRole,
  hasExistingPolicy,
  memberIds,
}: BlobPolicyUpdate): BlobPolicyDecision {
  if (!requesterRole) {
    return {
      allowed: false,
      reason: "Only project members can manage blobs",
    };
  }

  if (memberIds === null) {
    if (hasExistingPolicy && requesterRole !== "owner") {
      return {
        allowed: false,
        reason: "Only the project owner can remove a file restriction",
      };
    }
    return { allowed: true };
  }

  if (requesterRole !== "owner") {
    return {
      allowed: false,
      reason: "Only the project owner can change file access",
    };
  }

  return { allowed: true };
}

export function canDownloadBlob({
  isOwner,
  hasPolicy,
  hasGrant,
}: {
  isOwner: boolean;
  hasPolicy: boolean;
  hasGrant: boolean;
}) {
  return isOwner || !hasPolicy || hasGrant;
}
