import { Hono } from "hono";
import { handle } from "hono/vercel";
import { requestTracker } from "@/api/middleware/request-tracker.middleware";
import { authRoutes } from "@/api/modules/auth/auth.routes";
import { blobRoutes } from "@/api/modules/blobs/blobs.routes";
import { projectRoutes } from "@/api/modules/projects/projects.routes";
import { statusRoutes } from "@/api/modules/status/status.routes";
import { performHealthCheck } from "@/lib/health";

// Configure runtime for Vercel
export const runtime = "nodejs";

const app = new Hono().basePath("/api");

// Track all API requests for error rate monitoring
app.use("*", requestTracker);

// Enhanced health check - tests DB, R2, GitHub
app.get("/health", async (c) => {
  const result = await performHealthCheck();
  console.log(process.env);
  return c.json(result, result.healthy ? 200 : 503);
});

app.route("/auth", authRoutes);
app.route("/projects", projectRoutes);
app.route("/status", statusRoutes);
app.route("/", blobRoutes);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
