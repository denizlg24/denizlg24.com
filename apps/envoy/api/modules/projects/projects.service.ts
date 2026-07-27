import { prisma } from "@/lib/prisma";

export async function createProject(userId: string) {
  const project = await prisma.project.create({
    data: {
      members: {
        create: {
          userId,
          role: "owner",
        },
      },
    },
  });

  return project;
}

export async function getHead(projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });
  if (!project?.head_commit_hash) {
    return null;
  }
  return project.head_commit_hash;
}

export async function updateHead({
  projectId,
  newHead,
  expectedHead,
}: {
  projectId: string;
  newHead: string;
  expectedHead: string | null;
}) {
  const currentHead = expectedHead ?? "";
  const updatedProject = await prisma.project.updateMany({
    where: {
      id: projectId,
      head_commit_hash: currentHead,
    },
    data: {
      head_commit_hash: {
        set: newHead,
      },
    },
  });

  return updatedProject.count === 1 ? newHead : null;
}

export async function addMember({
  projectId,
  userId,
  nickname,
}: {
  projectId: string;
  userId: string;
  nickname?: string;
}) {
  const existingMember = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId,
        projectId,
      },
    },
  });

  if (existingMember) {
    return existingMember;
  }

  const projectMember = await prisma.projectMember.create({
    data: {
      projectId,
      userId,
      role: "user",
      nickname,
    },
  });

  return projectMember;
}

export async function deleteMember({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const deleted = await prisma.projectMember.delete({
    where: {
      userId_projectId: {
        userId,
        projectId,
      },
    },
  });
  return deleted;
}

export async function listProjectMembers(projectId: string) {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: true },
  });
  return members;
}

export async function deleteProjectMembers(projectId: string) {
  const deleted = await prisma.projectMember.deleteMany({
    where: {
      projectId,
      role: { not: "owner" },
    },
  });
  return deleted.count;
}
