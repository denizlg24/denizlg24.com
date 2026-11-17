import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/mongodb";
import { AiConnection, type IAiConnection } from "@/models/AiConnection";

export const GATEWAY_ID = "personal-gateway";
export async function readGateway(): Promise<IAiConnection | null> {
  await connectDB();
  return AiConnection.findById(GATEWAY_ID).lean<IAiConnection>().exec();
}

export async function replaceGateway(
  value: Omit<IAiConnection, "_id" | "revision">,
) {
  await connectDB();
  await AiConnection.findOneAndReplace(
    { _id: GATEWAY_ID },
    {
      ...value,
      _id: GATEWAY_ID,
      revision: randomUUID(),
    },
    { upsert: true },
  );
}

export async function disconnectGateway() {
  await connectDB();
  // Retain a generation tombstone so an in-flight callback cannot undo disconnect.
  await replaceGateway({ disconnected: true });
  // Cancel pending authorization callbacks as well as stored credentials.
  await AiConnection.deleteMany({ _id: /^vercel-flow:/ });
}

export async function recordGatewayTest(revision: string, error?: string) {
  await connectDB();
  await AiConnection.updateOne(
    { _id: GATEWAY_ID, revision },
    {
      $set: {
        status: error ? "error" : "connected",
        ...(error ? { lastError: error } : {}),
      },
      ...(!error ? { $unset: { lastError: 1 } } : {}),
    },
  );
}
