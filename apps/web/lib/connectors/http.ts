import { NextResponse } from "next/server";
import { ConnectorError } from "./service";

export function connectorErrorResponse(error: unknown) {
  if (error instanceof ConnectorError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  console.error("Connector route error:", error);
  return NextResponse.json(
    { error: "Connector request failed" },
    { status: 500 },
  );
}
