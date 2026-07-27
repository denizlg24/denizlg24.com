import type { Context } from "hono";
import {
  addMember as serviceAddMember,
  createProject as serviceCreateProject,
  listProjectMembers as serviceListProjectMembers,
  deleteMember as serviceDeleteMember,
  deleteProjectMembers as serviceDeleteProjectMembers,
  getHead as serviceGetHead,
  updateHead as serviceUpdateHead,
} from "./projects.service";
import { prisma } from "@/lib/prisma";

export async function createProject(c: Context) {
  const user = c.get("user");
  const project = await serviceCreateProject(user.id);
  return c.json({ projectId: project.id });
}

export async function getProjectHead(c: Context) {
  const requestingUser = c.get("user");
  const { projectId } = c.req.param();
  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }

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
      403
    );
  }
  const head = await serviceGetHead(projectId);
  return c.json({ head }, 200);
}

export async function updateProjectHead(c: Context) {
  const requestingUser = c.get("user");
  const { projectId } = c.req.param();
  const { new_head, expected_head } = await c.req.json();
  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }

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
      403
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
  return c.json({ head }, 200);
}

export async function addMember(c: Context) {
  const requestingUser = c.get("user");
  const { projectId } = c.req.param();
  const { githubId, nickname } = await c.req.json();

  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }
  if (!githubId) {
    return c.json({ error: "Missing User ID" }, 400);
  }

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember || projectMember.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can add members" },
      403
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

  return c.json({ projectMember: result });
}

export async function listMembers(c: Context) {
  const requestingUser = c.get("user");
  const { projectId } = c.req.param();

  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }

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
      403
    );
  }

  const members = await serviceListProjectMembers(projectId);

  return c.json({ members });
}

export async function removeMember(c: Context) {
  const requestingUser = c.get("user");
  const { projectId, userId } = c.req.param();

  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }
  if (!userId) {
    return c.json({ error: "Missing User ID" }, 400);
  }

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember || projectMember.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can remove members" },
      403
    );
  }

  if (userId === requestingUser.id) {
    return c.json({ error: "Cannot remove yourself as owner" }, 400);
  }

  const deleted = await serviceDeleteMember({ projectId, userId });

  return c.json({ success: true, deletedMember: deleted });
}

export async function removeAllMembers(c: Context) {
  const requestingUser = c.get("user");
  const { projectId } = c.req.param();

  if (!projectId) {
    return c.json({ error: "Missing Project ID" }, 400);
  }

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: requestingUser.id,
        projectId,
      },
    },
  });

  if (!projectMember || projectMember.role !== "owner") {
    return c.json(
      { error: "Unauthorized: Only project owners can remove all members" },
      403
    );
  }

  const deletedCount = await serviceDeleteProjectMembers(projectId);

  return c.json({ success: true, deletedCount });
}
