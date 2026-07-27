import { Hono } from "hono";
import { authMiddleware } from "@/api/middleware/auth.middleware";
import {
  addMember,
  createProject,
  getProjectHead,
  listMembers,
  removeAllMembers,
  removeMember,
  updateProjectHead,
} from "./projects.controller";

export const projectRoutes = new Hono();

projectRoutes.use("*", authMiddleware);
projectRoutes.post("/", createProject);
projectRoutes.get("/:projectId/members", listMembers);
projectRoutes.post("/:projectId/members", addMember);
projectRoutes.delete("/:projectId/members/:userId", removeMember);
projectRoutes.delete("/:projectId/members", removeAllMembers);
projectRoutes.get("/:projectId/head", getProjectHead);
projectRoutes.put("/:projectId/head", updateProjectHead);
