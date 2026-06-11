import { type NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdmin(request);
    if (authError) return authError;

    const body = await request.json();
    const { content, title, showHeader = true } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 },
      );
    }

    const browserlessApiKey = process.env.BROWSERLESS_API_KEY;
    if (!browserlessApiKey) {
      return NextResponse.json(
        { error: "Browserless API key not configured" },
        { status: 500 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!baseUrl || baseUrl.includes("localhost")) {
      return NextResponse.json(
        {
          error:
            "PDF export is only available in production. NEXT_PUBLIC_APP_URL must be set to a publicly accessible URL.",
        },
        { status: 400 },
      );
    }

    const params = new URLSearchParams({
      content: encodeURIComponent(content),
      title: encodeURIComponent(title || "Untitled"),
      ...(showHeader && { showHeader: "true" }),
    });
    const previewUrl = `${baseUrl}/pdf-preview?${params.toString()}`;

    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${browserlessApiKey}`,
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 2400, height: 1600 });

    await page.goto(previewUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${title || "note"}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 },
    );
  }
}
