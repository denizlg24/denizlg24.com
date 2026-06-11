import { type NextRequest, NextResponse } from "next/server";
import { runAllHealthChecks } from "@/lib/resource-agent";

export async function GET(request: NextRequest) {
  const token = process.env.HEALTH_CHECK_BEARER_TOKEN;
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAllHealthChecks();
    return NextResponse.json({ results });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
