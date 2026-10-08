import {
  mobileDeviceInputSchema,
  mobileInstallationIdSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { forgetMobileDevice, registerMobileDevice } from "@/lib/mobile-push";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ installationId: string }> };

async function installationId(context: Context) {
  const parsed = mobileInstallationIdSchema.safeParse(
    (await context.params).installationId,
  );
  return parsed.success ? parsed.data : null;
}

/** The whole reachability of one install; sent again on every change. */
export async function PUT(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const id = await installationId(context);
  if (!id) {
    return NextResponse.json(
      { error: "Invalid installation" },
      { status: 400 },
    );
  }
  const parsed = mobileDeviceInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid device" },
      { status: 400 },
    );
  }
  await registerMobileDevice(id, parsed.data);
  return NextResponse.json({ ok: true });
}

/** Sign-out: nothing should reach this install any more. */
export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const id = await installationId(context);
  if (!id) {
    return NextResponse.json(
      { error: "Invalid installation" },
      { status: 400 },
    );
  }
  await forgetMobileDevice(id);
  return NextResponse.json({ ok: true });
}
