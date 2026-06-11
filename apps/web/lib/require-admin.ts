import crypto from "node:crypto";
import { forbidden } from "next/navigation";
import type { NextRequest } from "next/server";
import ApiKey from "@/models/ApiKey";
import { getServerSession } from "./get-server-session";
import { connectDB } from "./mongodb";

export async function requireAdmin(request?: NextRequest) {
  const authorizationHeader = request?.headers.get("authorization");
  if (authorizationHeader) {
    const token = authorizationHeader.split("Bearer ")[1];
    if (token) {
      await connectDB();
      const adminTokenHash = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const adminTokenDoc = await ApiKey.findOne({
        key: adminTokenHash,
      }).lean();
      if (adminTokenDoc) {
        return null;
      }
    }
  }
  const session = await getServerSession(request);
  if (!session) {
    forbidden();
  }

  if (!session.user) {
    forbidden();
  }

  if (!session.user.emailVerified) {
    forbidden();
  }

  const userRole = session.user.role;
  if (userRole !== "admin") {
    forbidden();
  }

  return null;
}

export async function getAdminSession(request?: NextRequest) {
  const authorizationHeader = request?.headers.get("authorization");
  if (authorizationHeader) {
    const token = authorizationHeader.split("Bearer ")[1];
    if (token) {
      await connectDB();
      const adminTokenHash = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const adminTokenDoc = await ApiKey.findOne({
        key: adminTokenHash,
      }).lean();
      if (adminTokenDoc) {
        return {
          user: {
            email: "admin-token",
            role: "admin",
            emailVerified: true,
          },
        };
      }
    }
  }
  const session = await getServerSession(request);

  if (!session?.user) {
    return null;
  }

  if (!session.user.emailVerified) {
    return null;
  }

  const userRole = session.user.role;
  if (userRole !== "admin") {
    return null;
  }

  return session;
}
