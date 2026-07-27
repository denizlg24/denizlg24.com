import { Hono } from "hono";
import * as controller from "./auth.controller";

export const authRoutes = new Hono();

authRoutes.post("/github/device", controller.githubDevice);
authRoutes.post("/github/token", controller.githubToken);