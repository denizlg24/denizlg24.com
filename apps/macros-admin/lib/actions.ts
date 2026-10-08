"use server";

import {
  type MacrosContributionsQuery,
  type MacrosContributionsResponse,
  type MacrosContributorDetail,
  type MacrosResolveReportBody,
  type MacrosRevealContactResponse,
  type MacrosSetFoodRemovedBody,
  type MacrosSetRestrictionBody,
  macrosContributionsQuerySchema,
  macrosResolveReportBodySchema,
  macrosSetFoodRemovedBodySchema,
  macrosSetRestrictionBodySchema,
} from "@repo/schemas/macros";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionFailure, ActionResult } from "@/lib/action-result";
import { type ApiFailure, macrosApi } from "@/lib/macros-api";
import { ownerSession } from "@/lib/session";

const itemIdSchema = z.uuid();
const userIdSchema = z.string().trim().min(1).max(200);

const INVALID: ActionFailure = { ok: false, error: "Invalid request" };
const SIGNED_OUT: ActionFailure = {
  ok: false,
  error: "Session ended — reload to sign in",
};

function failed(failure: ApiFailure): ActionFailure {
  if (failure.status === 403) return { ok: false, error: "Not allowed" };
  return {
    ok: false,
    error: failure.status
      ? `${failure.error} (${failure.status})`
      : failure.error,
  };
}

function refreshEverything() {
  revalidatePath("/", "layout");
}

export async function resolveReportAction(
  itemId: string,
  input: MacrosResolveReportBody,
): Promise<ActionResult> {
  const id = itemIdSchema.safeParse(itemId);
  const body = macrosResolveReportBodySchema.safeParse(input);
  if (!id.success || !body.success) return INVALID;
  const session = await ownerSession();
  if (!session) return SIGNED_OUT;

  const result = await macrosApi(session).resolveReport(id.data, body.data);
  if (!result.ok) return failed(result);
  refreshEverything();
  return { ok: true, data: null };
}

export async function setFoodRemovedAction(
  itemId: string,
  input: MacrosSetFoodRemovedBody,
): Promise<ActionResult> {
  const id = itemIdSchema.safeParse(itemId);
  const body = macrosSetFoodRemovedBodySchema.safeParse(input);
  if (!id.success || !body.success) return INVALID;
  const session = await ownerSession();
  if (!session) return SIGNED_OUT;

  const result = await macrosApi(session).setFoodRemoved(id.data, body.data);
  if (!result.ok) return failed(result);
  refreshEverything();
  return { ok: true, data: null };
}

export async function setRestrictionAction(
  userId: string,
  input: MacrosSetRestrictionBody,
): Promise<ActionResult<MacrosContributorDetail | null>> {
  const id = userIdSchema.safeParse(userId);
  const body = macrosSetRestrictionBodySchema.safeParse(input);
  if (!id.success || !body.success) return INVALID;
  const session = await ownerSession();
  if (!session) return SIGNED_OUT;

  const result = await macrosApi(session).setRestriction(id.data, body.data);
  if (!result.ok) return failed(result);
  refreshEverything();
  return { ok: true, data: result.data };
}

export async function revealContactAction(
  userId: string,
): Promise<ActionResult<MacrosRevealContactResponse>> {
  const id = userIdSchema.safeParse(userId);
  if (!id.success) return INVALID;
  const session = await ownerSession();
  if (!session) return SIGNED_OUT;

  const result = await macrosApi(session).revealContact(id.data);
  if (!result.ok) return failed(result);
  // The reveal is itself an audit event; the history on the page should show it.
  refreshEverything();
  return { ok: true, data: result.data };
}

export async function loadContributionsAction(
  input: MacrosContributionsQuery,
): Promise<ActionResult<MacrosContributionsResponse>> {
  const query = macrosContributionsQuerySchema.safeParse(input);
  if (!query.success) return INVALID;
  const session = await ownerSession();
  if (!session) return SIGNED_OUT;

  const result = await macrosApi(session).contributions(query.data);
  if (!result.ok) return failed(result);
  return { ok: true, data: result.data };
}
