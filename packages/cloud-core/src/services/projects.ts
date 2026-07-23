import { eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import { folders, projects } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { isPostgresErrorCode } from "./database-errors";
import { pagination } from "./pagination";
import type { SafeProjectRecord } from "./types";

export async function createProject(
  db: Database,
  input: {
    name: string;
    slug: string;
    description?: string;
    ownerId: string;
    storageRootPath: string;
  },
): Promise<SafeProjectRecord> {
  try {
    return await db.transaction(async (tx) => {
      const [folder] = await tx
        .insert(folders)
        .values({
          ownerId: input.ownerId,
          path: `/${input.slug}`,
          name: input.slug,
        })
        .returning();

      if (!folder) {
        throw new Error("Failed to create project storage folder");
      }

      const [project] = await tx
        .insert(projects)
        .values({
          name: input.name,
          slug: input.slug,
          description: input.description,
          ownerId: input.ownerId,
          storageFolderId: folder.id,
        })
        .returning();

      if (!project) {
        throw new Error("Failed to create project");
      }

      return project;
    });
  } catch (error) {
    if (isPostgresErrorCode(error, "23505")) {
      throw new ConflictError(
        "Project slug or storage path already exists",
        "PROJECT_EXISTS",
      );
    }
    throw error;
  }
}

export async function listProjects(
  db: Database,
  options: { page?: number; limit?: number } = {},
): Promise<{ projects: SafeProjectRecord[]; total: number }> {
  const { limit, offset } = pagination(options, { limit: 50 });
  const [allProjects, countResult] = await Promise.all([
    db
      .select()
      .from(projects)
      .orderBy(projects.createdAt)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(projects),
  ]);

  return {
    projects: allProjects,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getProject(
  db: Database,
  projectId: string,
): Promise<SafeProjectRecord> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
  }
  return project;
}

export async function getProjectBySlug(
  db: Database,
  slug: string,
): Promise<SafeProjectRecord> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, slug),
  });

  if (!project) {
    throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
  }
  return project;
}

export async function updateProject(
  db: Database,
  projectId: string,
  input: { name?: string; description?: string },
): Promise<SafeProjectRecord> {
  const [updated] = await db
    .update(projects)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  if (!updated) {
    throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
  }
  return updated;
}

export async function deleteProject(
  db: Database,
  projectId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [project] = await tx
      .delete(projects)
      .where(eq(projects.id, projectId))
      .returning({ storageFolderId: projects.storageFolderId });

    if (!project) {
      throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
    }

    if (project.storageFolderId) {
      await tx.delete(folders).where(eq(folders.id, project.storageFolderId));
    }
  });
}
