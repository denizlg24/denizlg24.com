import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "./auth";

export const getServerSession = async (request?: NextRequest) => {
  return await auth.api.getSession({
    headers: request ? request.headers : await headers(),
  });
};
