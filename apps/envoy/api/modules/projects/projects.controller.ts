import {
  envoyAddMemberInputSchema,
  envoyCreateProjectResponseSchema,
  envoyHeadResponseSchema,
  envoyProjectMemberParamsSchema,
  envoyProjectMemberResponseSchema,
  envoyProjectMembersResponseSchema,
  envoyProjectParamsSchema,
  envoyRemoveAllMembersResponseSchema,
  envoyRemoveMemberResponseSchema,
  envoyUpdateHeadInputSchema,
} from "@repo/schemas/envoy";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma";
import {
  addMember as serviceAddMember,
  createProject as serviceCreateProject,
  deleteMember as serviceDeleteMember,
  deleteProjectMembers as serviceDeleteProjectMembers,
  getHead as serviceGetHead,
  listProjectMembers as serviceListProjectMembers,
  updateHead as serviceUpdateHead,
} from "./projects.service";

function parseProjectParams(c: Context) {
  return envoyProjectParamsSchema.safeParse(c.req.param());
}

export async function createProject(c: Context) {
  const user = c.get("user");
  const project = await serviceCreateProject(user.id);
  return c.json(
    envoyCreateProjectResponseSchema.parse({ projectId: project.id }),
  );
}

export async function getProjectHead(c: Context) {
  const requestingUser = c.get("user");
  const params = parseProjectParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid Project ID" }, 400);
  }
  const { projectId } = params.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember) {
    return c.json(
      { error: "Unauthorized: Only project members can get current head." },
      403,
    );
  }
  const head = await serviceGetHead(projectId);
  return c.json(envoyHeadResponseSchema.parse({ head }), 200);
}

export async function updateProjectHead(c: Context) {
  const requestingUser = c.get("user");
  const params = parseProjectParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid Project ID" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = envoyUpdateHeadInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid head update" }, 400);
  }
  const { projectId } = params.data;
  const { new_head, expected_head } = parsed.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember) {
    return c.json(
      { error: "Unauthorized: Only project members can update current head." },
      403,
    );
  }
  const head = await serviceUpdateHead({
    projectId,
    newHead: new_head,
    expectedHead: expected_head ?? null,
  });
  if (!head) {
    return c.json({ error: "Expected head doesn't match current head." }, 409);
  }
  return c.json(envoyHeadResponseSchema.parse({ head }), 200);
}

export async function addMember(c: Context) {
  const requestingUser = c.get("user");
  const params = parseProjectParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid Project ID" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = envoyAddMemberInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid GitHub user ID or nickname" }, 400);
  }
  const { projectId } = params.data;
  const { githubId, nickname } = parsed.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (projectMember?.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can add members" },
      403,
    );
  }

  const user = await prisma.user.upsert({
    where: { githubId },
    update: {},
    create: { githubId },
    select: { id: true },
  });

  const result = await serviceAddMember({
    projectId,
    userId: user.id,
    nickname,
  });

  return c.json(
    envoyProjectMemberResponseSchema.parse({ projectMember: result }),
  );
}

export async function listMembers(c: Context) {
  const requestingUser = c.get("user");
  const params = parseProjectParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid Project ID" }, 400);
  }
  const { projectId } = params.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember) {
    return c.json(
      { error: "Unauthorized: You are not a member of this project" },
      403,
    );
  }

  const members = await serviceListProjectMembers(projectId);

  return c.json(
    envoyProjectMembersResponseSchema.parse({
      members: members.map(({ user, ...member }) => ({
        ...member,
        user: {
          id: user.id,
          email: user.email,
          githubId: user.githubId,
          createdAt: user.createdAt.toISOString(),
        },
      })),
    }),
  );
}

export async function removeMember(c: Context) {
  const requestingUser = c.get("user");
  const params = envoyProjectMemberParamsSchema.safeParse(c.req.param());
  if (!params.success) {
    return c.json({ error: "Invalid Project ID or User ID" }, 400);
  }
  const { projectId, userId } = params.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (projectMember?.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can remove members" },
      403,
    );
  }

  if (userId === requestingUser.id) {
    return c.json({ error: "Cannot remove yourself as owner" }, 400);
  }

  const deleted = await serviceDeleteMember({ projectId, userId });

  return c.json(
    envoyRemoveMemberResponseSchema.parse({
      success: true,
      deletedMember: deleted,
    }),
  );
}

export async function removeAllMembers(c: Context) {
  const requestingUser = c.get("user");
  const params = parseProjectParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid Project ID" }, 400);
  }
  const { projectId } = params.data;

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (projectMember?.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can remove all members" },
      403,
    );
  }

  const deletedCount = await serviceDeleteProjectMembers(projectId);

  return c.json(
    envoyRemoveAllMembersResponseSchema.parse({
      success: true,
      deletedCount,
    }),
  );
}
