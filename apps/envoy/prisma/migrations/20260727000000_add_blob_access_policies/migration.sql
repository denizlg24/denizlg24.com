-- File-level access is opt-in so existing blobs remain available to every
-- project member. A policy row with no grants means owner-only.
CREATE TABLE "BlobAccessPolicy" (
    "projectId" TEXT NOT NULL,
    "blobHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlobAccessPolicy_pkey" PRIMARY KEY ("projectId", "blobHash")
);

CREATE TABLE "BlobAccessGrant" (
    "projectId" TEXT NOT NULL,
    "blobHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlobAccessGrant_pkey" PRIMARY KEY ("projectId", "blobHash", "userId")
);

CREATE INDEX "BlobAccessGrant_userId_idx" ON "BlobAccessGrant"("userId");

ALTER TABLE "BlobAccessPolicy"
ADD CONSTRAINT "BlobAccessPolicy_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlobAccessGrant"
ADD CONSTRAINT "BlobAccessGrant_projectId_blobHash_fkey"
FOREIGN KEY ("projectId", "blobHash")
REFERENCES "BlobAccessPolicy"("projectId", "blobHash") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlobAccessGrant"
ADD CONSTRAINT "BlobAccessGrant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
