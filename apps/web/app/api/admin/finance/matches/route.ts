import { financeMatchReviewStatusSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { listFinanceMatchReviews } from "@/lib/finance/queries";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const status = financeMatchReviewStatusSchema.safeParse(
    request.nextUrl.searchParams.get("status") ?? "pending",
  );
  if (!status.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  try {
    const reviews = await listFinanceMatchReviews(status.data);
    return NextResponse.json({
      reviews: reviews.map((review) => ({
        id: review._id.toString(),
        sourceLedgerId: review.sourceLedgerId.toString(),
        candidateBankLedgerId: review.candidateBankLedgerId.toString(),
        confidence: review.confidence,
        status: review.status,
        createdAt: review.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[finance] Match review list failed", error);
    return NextResponse.json(
      { error: "Failed to list match reviews" },
      { status: 500 },
    );
  }
}
