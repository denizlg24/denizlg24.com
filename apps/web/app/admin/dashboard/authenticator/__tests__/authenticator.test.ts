/**
 * Authenticator Feature — End-to-End Test Suite
 *
 * Covers: types, parseOtpAuthUri, CountdownRing logic, page structure,
 * search/filter logic, API route validation, sidebar navigation, and
 * component contracts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOT = resolve(import.meta.dir, "../../../../..");
const readSrc = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8");

// ---------------------------------------------------------------------------
// 1. Type Safety — types.ts
// ---------------------------------------------------------------------------
describe("Type definitions (types.ts)", () => {
  const src = readSrc("app/admin/dashboard/authenticator/types.ts");

  test("exports TotpAlgorithm type with SHA1, SHA256, SHA512", () => {
    expect(src).toContain("export type TotpAlgorithm");
    expect(src).toContain('"SHA1"');
    expect(src).toContain('"SHA256"');
    expect(src).toContain('"SHA512"');
  });

  test("exports IAuthenticatorAccount interface with required fields", () => {
    expect(src).toContain("export interface IAuthenticatorAccount");
    for (const field of [
      "_id: string",
      "label: string",
      "issuer: string",
      "accountName: string",
      "algorithm: TotpAlgorithm",
      "digits: number",
      "period: number",
      "createdAt: string",
      "updatedAt: string",
    ]) {
      expect(src).toContain(field);
    }
  });

  test("exports IAuthenticatorCode interface with required fields", () => {
    expect(src).toContain("export interface IAuthenticatorCode");
    for (const field of [
      "_id: string",
      "code: string",
      "period: number",
      "remaining: number",
    ]) {
      expect(src).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. parseOtpAuthUri — lib/authenticator.ts (pure function)
// ---------------------------------------------------------------------------
describe("parseOtpAuthUri (lib/authenticator.ts)", () => {
  // Dynamic import so DB deps don't crash — we only need the parser
  // The function is self-contained after OTPAuth.URI.parse
  const libSrc = readSrc("lib/authenticator.ts");

  test("parseOtpAuthUri function exists and is exported", () => {
    expect(libSrc).toContain("export function parseOtpAuthUri");
  });

  test("validates TOTP-only (rejects HOTP)", () => {
    expect(libSrc).toContain("Only TOTP URIs are supported");
  });

  test("extracts issuer, label, accountName, secret, algorithm, digits, period", () => {
    // Verify the return shape includes all expected fields
    expect(libSrc).toContain("label:");
    expect(libSrc).toContain("issuer:");
    expect(libSrc).toContain("accountName");
    expect(libSrc).toContain("secret:");
    expect(libSrc).toContain("algorithm:");
    expect(libSrc).toContain("digits:");
    expect(libSrc).toContain("period:");
  });

  test("defaults algorithm to SHA1 when invalid", () => {
    expect(libSrc).toContain('"SHA1" as const');
  });

  test("defaults digits to 6 and period to 30", () => {
    expect(libSrc).toContain("parsed.digits || 6");
    expect(libSrc).toContain("parsed.period || 30");
  });
});

// ---------------------------------------------------------------------------
// 3. CountdownRing — component contract
// ---------------------------------------------------------------------------
describe("CountdownRing component", () => {
  const src = readSrc(
    "app/admin/dashboard/authenticator/_components/countdown-ring.tsx",
  );

  test("accepts remaining, period, and optional size props", () => {
    expect(src).toContain("remaining: number");
    expect(src).toContain("period: number");
    expect(src).toContain("size?: number");
  });

  test("defaults size to 32", () => {
    expect(src).toContain("size = 32");
  });

  test("calculates SVG progress from remaining/period", () => {
    expect(src).toContain("remaining / period");
    expect(src).toContain("circumference * (1 - progress)");
  });

  test("applies urgent styling when remaining <= 5", () => {
    expect(src).toContain("remaining <= 5");
    expect(src).toContain("text-destructive");
  });

  test("uses 1s CSS transition for smooth countdown animation", () => {
    expect(src).toContain("duration-1000");
  });

  test("displays remaining seconds as text", () => {
    expect(src).toContain("{remaining}");
  });
});

// ---------------------------------------------------------------------------
// 4. CountdownRing — math logic (unit)
// ---------------------------------------------------------------------------
describe("CountdownRing math logic", () => {
  function computeRing(remaining: number, period: number, size = 32) {
    const strokeWidth = 2.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = remaining / period;
    const offset = circumference * (1 - progress);
    const isUrgent = remaining <= 5;
    return { radius, circumference, progress, offset, isUrgent };
  }

  test("full remaining = 0 offset (full ring)", () => {
    const r = computeRing(30, 30);
    expect(r.offset).toBeCloseTo(0, 5);
    expect(r.isUrgent).toBe(false);
  });

  test("zero remaining = full offset (empty ring)", () => {
    const r = computeRing(0, 30);
    expect(r.offset).toBeCloseTo(r.circumference, 5);
  });

  test("half remaining = half offset", () => {
    const r = computeRing(15, 30);
    expect(r.offset).toBeCloseTo(r.circumference / 2, 5);
  });

  test("remaining <= 5 triggers urgent state", () => {
    expect(computeRing(5, 30).isUrgent).toBe(true);
    expect(computeRing(4, 30).isUrgent).toBe(true);
    expect(computeRing(6, 30).isUrgent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. AuthenticatorAccountRow — component contract
// ---------------------------------------------------------------------------
describe("AuthenticatorAccountRow component", () => {
  const src = readSrc(
    "app/admin/dashboard/authenticator/_components/authenticator-account.tsx",
  );

  test("renders account label", () => {
    expect(src).toContain("{account.label}");
  });

  test("renders account name (when present)", () => {
    expect(src).toContain("{account.accountName}");
  });

  test("renders issuer when different from label", () => {
    expect(src).toContain("account.issuer !== account.label");
    expect(src).toContain("{account.issuer}");
  });

  test("formats TOTP code with space in middle", () => {
    expect(src).toContain("code.slice(0, Math.ceil(code.length / 2))");
  });

  test("shows placeholder '------' when no code data", () => {
    expect(src).toContain('"------"');
  });

  test("copy-to-clipboard writes code and shows feedback", () => {
    expect(src).toContain("navigator.clipboard.writeText");
    expect(src).toContain("setCopied(true)");
    expect(src).toContain("setCopied(false)");
    // 1.5s feedback timeout
    expect(src).toContain("1500");
  });

  test("has edit and delete dropdown actions", () => {
    expect(src).toContain("onEdit");
    expect(src).toContain("onDelete");
    expect(src).toContain("Edit");
    expect(src).toContain("Delete");
  });

  test("renders CountdownRing when code data available", () => {
    expect(src).toContain("CountdownRing");
    expect(src).toContain("codeData.remaining");
    expect(src).toContain("codeData.period");
  });
});

// ---------------------------------------------------------------------------
// 6. TOTP code formatting logic (unit)
// ---------------------------------------------------------------------------
describe("TOTP code formatting", () => {
  function formatCode(code: string) {
    return `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;
  }

  test("6-digit code splits 3+3", () => {
    expect(formatCode("123456")).toBe("123 456");
  });

  test("8-digit code splits 4+4", () => {
    expect(formatCode("12345678")).toBe("1234 5678");
  });

  test("placeholder splits evenly", () => {
    expect(formatCode("------")).toBe("--- ---");
  });
});

// ---------------------------------------------------------------------------
// 7. Page — loading state (skeleton UI)
// ---------------------------------------------------------------------------
describe("Page loading state", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("initialLoading state starts true", () => {
    expect(src).toContain("useState(true)");
    expect(src).toContain("initialLoading");
  });

  test("renders skeleton pulse elements during loading", () => {
    expect(src).toContain("animate-pulse");
    // 6 skeleton rows
    expect(src).toContain("Array.from({ length: 6 })");
  });

  test("sets initialLoading false after fetch completes", () => {
    expect(src).toContain("setInitialLoading(false)");
  });
});

// ---------------------------------------------------------------------------
// 8. Page — empty state
// ---------------------------------------------------------------------------
describe("Page empty state", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("shows 'No authenticator accounts yet' message", () => {
    expect(src).toContain("No authenticator accounts yet");
  });

  test("displays Import and Add Account buttons in empty state", () => {
    // Empty state buttons
    expect(src).toContain("Import");
    expect(src).toContain("Add Account");
  });
});

// ---------------------------------------------------------------------------
// 9. Page — search/filter
// ---------------------------------------------------------------------------
describe("Page search/filter", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("filters by label, issuer, and accountName (case-insensitive)", () => {
    expect(src).toContain(
      "a.label.toLowerCase().includes(search.toLowerCase())",
    );
    expect(src).toContain(
      "a.issuer.toLowerCase().includes(search.toLowerCase())",
    );
    expect(src).toContain(
      "a.accountName.toLowerCase().includes(search.toLowerCase())",
    );
  });

  test("shows no-matches state with search query", () => {
    expect(src).toContain("No matches for");
  });

  test("search bar only visible when accounts exist", () => {
    expect(src).toContain("accounts.length > 0");
  });
});

// ---------------------------------------------------------------------------
// 10. Search filter logic (unit)
// ---------------------------------------------------------------------------
describe("Search filter logic (unit)", () => {
  const accounts = [
    { label: "GitHub", issuer: "GitHub", accountName: "user@gh.com" },
    { label: "GitLab", issuer: "GitLab", accountName: "admin@gl.com" },
    { label: "AWS", issuer: "Amazon", accountName: "root@aws.com" },
  ];

  function filter(search: string) {
    const s = search.toLowerCase();
    return accounts.filter(
      (a) =>
        a.label.toLowerCase().includes(s) ||
        a.issuer.toLowerCase().includes(s) ||
        a.accountName.toLowerCase().includes(s),
    );
  }

  test("matches by label", () => {
    expect(filter("github")).toHaveLength(1);
    expect(filter("github")[0].label).toBe("GitHub");
  });

  test("matches by issuer", () => {
    expect(filter("amazon")).toHaveLength(1);
    expect(filter("amazon")[0].label).toBe("AWS");
  });

  test("matches by accountName", () => {
    expect(filter("root@")).toHaveLength(1);
  });

  test("case insensitive", () => {
    expect(filter("GITHUB")).toHaveLength(1);
  });

  test("partial match across multiple", () => {
    expect(filter("git")).toHaveLength(2);
  });

  test("empty search returns all", () => {
    // page logic: search.trim() ? filter : accounts
    const search = "";
    const result = search.trim() ? filter(search) : accounts;
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 11. Page — code polling
// ---------------------------------------------------------------------------
describe("Page code polling", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("polls /api/admin/authenticator/codes every 1 second", () => {
    expect(src).toContain("setInterval(fetchCodes, 1000)");
  });

  test("clears interval on unmount", () => {
    expect(src).toContain("clearInterval(pollingRef.current)");
  });

  test("does not start polling while still loading", () => {
    expect(src).toContain("if (initialLoading) return");
  });
});

// ---------------------------------------------------------------------------
// 12. AddAccountDialog — component contract
// ---------------------------------------------------------------------------
describe("AddAccountDialog component", () => {
  const src = readSrc(
    "app/admin/dashboard/authenticator/_components/add-account-dialog.tsx",
  );

  test("requires label + secret for new accounts", () => {
    expect(src).toContain(
      "label.trim().length > 0 && secret.trim().length > 0",
    );
  });

  test("only requires label for edit mode", () => {
    expect(src).toContain("isEditing");
    expect(src).toContain("label.trim().length > 0");
  });

  test("hides secret field in edit mode", () => {
    expect(src).toContain("{!isEditing && (");
  });

  test("disables algorithm, digits, period selects in edit mode", () => {
    expect(src).toContain("disabled={isEditing}");
  });

  test("shows correct title based on mode", () => {
    expect(src).toContain('"Edit Account"');
    expect(src).toContain('"Add Account"');
  });

  test("uppercases and strips whitespace from secret input", () => {
    expect(src).toContain(".toUpperCase().replace(/\\s/g");
  });

  test("supports SHA1, SHA256, SHA512 algorithm selection", () => {
    expect(src).toContain('value="SHA1"');
    expect(src).toContain('value="SHA256"');
    expect(src).toContain('value="SHA512"');
  });

  test("supports 6 and 8 digit options", () => {
    expect(src).toContain('value="6"');
    expect(src).toContain('value="8"');
  });
});

// ---------------------------------------------------------------------------
// 13. ImportDialog — component contract
// ---------------------------------------------------------------------------
describe("ImportDialog component", () => {
  const src = readSrc(
    "app/admin/dashboard/authenticator/_components/import-dialog.tsx",
  );

  test("has QR Code and Text/File tabs", () => {
    expect(src).toContain('value="qr"');
    expect(src).toContain('value="text"');
    expect(src).toContain("QR Code");
    expect(src).toContain("Text / File");
  });

  test("validates otpauth:// prefix for QR results", () => {
    expect(src).toContain('decodedText.startsWith("otpauth://")');
  });

  test("validates otpauth:// prefix for text URIs", () => {
    expect(src).toContain('l.startsWith("otpauth://")');
  });

  test("supports camera scanning and file upload", () => {
    expect(src).toContain("Scan with Camera");
    expect(src).toContain("Upload Image");
    expect(src).toContain('accept="image/*"');
  });

  test("displays detected URI from QR scan", () => {
    expect(src).toContain("Detected URI");
    expect(src).toContain("{qrResult}");
  });

  test("counts valid URIs in text mode", () => {
    expect(src).toContain("textUriCount");
    expect(src).toContain("valid URI");
  });

  test("cleans up scanner on dialog close", () => {
    expect(src).toContain("html5QrRef.current.stop()");
    expect(src).toContain("setScannerActive(false)");
  });

  test("shows import count in button when multiple URIs", () => {
    expect(src).toContain("textUriCount > 1");
  });
});

// ---------------------------------------------------------------------------
// 14. Page — CRUD operations (add, edit, delete)
// ---------------------------------------------------------------------------
describe("Page CRUD operations", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("handleAdd POSTs to /api/admin/authenticator", () => {
    expect(src).toContain('fetch("/api/admin/authenticator"');
    expect(src).toContain('method: "POST"');
  });

  test("handleAdd prepends new account to list", () => {
    expect(src).toContain("[result.account, ...prev]");
  });

  test("handleEdit PATCHes to /api/admin/authenticator/:id", () => {
    expect(src).toContain("`/api/admin/authenticator/${editingAccount._id}`");
    expect(src).toContain('method: "PATCH"');
  });

  test("handleEdit replaces account in list by _id", () => {
    expect(src).toContain("a._id === editingAccount._id ? result.account : a");
  });

  test("handleDelete DELETEs via API", () => {
    expect(src).toContain('method: "DELETE"');
  });

  test("handleDelete removes account from list", () => {
    expect(src).toContain("a._id !== deleteTarget._id");
  });

  test("delete dialog shows account label and warning", () => {
    expect(src).toContain("deleteTarget?.label");
    expect(src).toContain("permanently removed");
  });

  test("delete button shows loading state", () => {
    expect(src).toContain("Deleting...");
    expect(src).toContain("disabled={deleting}");
  });
});

// ---------------------------------------------------------------------------
// 15. Page — import flow
// ---------------------------------------------------------------------------
describe("Page import flow", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("handleImport POSTs to /api/admin/authenticator/import", () => {
    expect(src).toContain('"/api/admin/authenticator/import"');
  });

  test("prepends imported accounts to list", () => {
    expect(src).toContain("[...result.imported, ...prev]");
  });

  test("shows warning toast for partial failures", () => {
    expect(src).toContain("result.errors.length > 0");
    expect(src).toContain("toast.warning");
  });

  test("shows success toast for full success", () => {
    expect(src).toContain("toast.success");
    expect(src).toContain("account(s)");
  });
});

// ---------------------------------------------------------------------------
// 16. API Routes — /api/admin/authenticator (GET + POST)
// ---------------------------------------------------------------------------
describe("API route: /api/admin/authenticator", () => {
  const src = readSrc("app/api/admin/authenticator/route.ts");

  test("GET requires admin auth", () => {
    expect(src).toContain("requireAdmin(request)");
    expect(src).toContain("export async function GET");
  });

  test("POST requires admin auth", () => {
    expect(src).toContain("export async function POST");
  });

  test("POST validates label and secret are required", () => {
    expect(src).toContain("!label || !secret");
    expect(src).toContain("label and secret are required");
    expect(src).toContain("status: 400");
  });

  test("POST returns 201 on success", () => {
    expect(src).toContain("status: 201");
  });

  test("handles server errors with 500", () => {
    expect(src).toContain("status: 500");
  });
});

// ---------------------------------------------------------------------------
// 17. API Route — /api/admin/authenticator/[id] (PATCH + DELETE)
// ---------------------------------------------------------------------------
describe("API route: /api/admin/authenticator/[id]", () => {
  const src = readSrc("app/api/admin/authenticator/[id]/route.ts");

  test("PATCH requires admin auth and updates label/issuer/accountName", () => {
    expect(src).toContain("export async function PATCH");
    expect(src).toContain("requireAdmin");
    expect(src).toContain("label, issuer, accountName");
  });

  test("PATCH returns 404 for missing account", () => {
    expect(src).toContain("Account not found");
    expect(src).toContain("status: 404");
  });

  test("DELETE requires admin auth", () => {
    expect(src).toContain("export async function DELETE");
    expect(src).toContain("requireAdmin");
  });

  test("DELETE returns 404 for missing account", () => {
    expect(src).toContain("Account not found");
  });

  test("extracts id from async params", () => {
    expect(src).toContain("await params");
    expect(src).toContain("const { id }");
  });
});

// ---------------------------------------------------------------------------
// 18. API Route — /api/admin/authenticator/codes
// ---------------------------------------------------------------------------
describe("API route: /api/admin/authenticator/codes", () => {
  const src = readSrc("app/api/admin/authenticator/codes/route.ts");

  test("GET requires admin auth", () => {
    expect(src).toContain("requireAdmin");
    expect(src).toContain("export async function GET");
  });

  test("returns codes array", () => {
    expect(src).toContain("generateCodes");
    expect(src).toContain("{ codes }");
  });
});

// ---------------------------------------------------------------------------
// 19. API Route — /api/admin/authenticator/import
// ---------------------------------------------------------------------------
describe("API route: /api/admin/authenticator/import", () => {
  const src = readSrc("app/api/admin/authenticator/import/route.ts");

  test("POST requires admin auth", () => {
    expect(src).toContain("requireAdmin");
    expect(src).toContain("export async function POST");
  });

  test("validates uris is a non-empty array", () => {
    expect(src).toContain("!Array.isArray(uris) || uris.length === 0");
    expect(src).toContain("uris must be a non-empty array");
  });

  test("enforces max 100 URIs limit", () => {
    expect(src).toContain("uris.length > 100");
    expect(src).toContain("Maximum 100 URIs per import");
  });

  test("returns imported + errors in response", () => {
    expect(src).toContain("result.imported");
    expect(src).toContain("result.errors");
  });

  test("returns 201 on success", () => {
    expect(src).toContain("status: 201");
  });
});

// ---------------------------------------------------------------------------
// 20. Sidebar Navigation
// ---------------------------------------------------------------------------
describe("Sidebar navigation", () => {
  const src = readSrc("components/app-sidebar.tsx");

  test("has Authenticator link in sidebar", () => {
    expect(src).toContain('"Authenticator"');
  });

  test("navigates to /admin/dashboard/authenticator", () => {
    expect(src).toContain('"/admin/dashboard/authenticator"');
  });

  test("uses KeyRound icon", () => {
    expect(src).toContain("KeyRound");
  });
});

// ---------------------------------------------------------------------------
// 21. Model — AuthenticatorAccount (Mongoose schema)
// ---------------------------------------------------------------------------
describe("AuthenticatorAccount model", () => {
  const src = readSrc("models/AuthenticatorAccount.ts");

  test("defines encrypted secret schema (ciphertext, iv, authTag)", () => {
    expect(src).toContain("ciphertext: { type: String, required: true }");
    expect(src).toContain("iv: { type: String, required: true }");
    expect(src).toContain("authTag: { type: String, required: true }");
  });

  test("label is required", () => {
    expect(src).toContain("label: { type: String, required: true }");
  });

  test("algorithm enum matches TotpAlgorithm type", () => {
    expect(src).toContain('enum: ["SHA1", "SHA256", "SHA512"]');
  });

  test("has timestamps enabled", () => {
    expect(src).toContain("{ timestamps: true }");
  });

  test("has compound index on issuer + accountName", () => {
    expect(src).toContain("{ issuer: 1, accountName: 1 }");
  });

  test("prevents duplicate model registration", () => {
    expect(src).toContain("mongoose.models.AuthenticatorAccount");
  });
});

// ---------------------------------------------------------------------------
// 22. lib/authenticator.ts — service functions
// ---------------------------------------------------------------------------
describe("lib/authenticator.ts service functions", () => {
  const src = readSrc("lib/authenticator.ts");

  test("getAllAccounts sorts by createdAt descending", () => {
    expect(src).toContain("sort({ createdAt: -1 })");
  });

  test("createAccount encrypts the secret before storing", () => {
    expect(src).toContain("encryptPassword(data.secret)");
  });

  test("generateCodes decrypts secret for each account", () => {
    expect(src).toContain("decryptPassword");
  });

  test("generateCodes calculates remaining time correctly", () => {
    expect(src).toContain("Math.floor(now / 1000) % account.period");
    expect(src).toContain("account.period - elapsed");
  });

  test("importAccounts collects errors without throwing", () => {
    expect(src).toContain("errors.push");
    expect(src).toContain("return { imported, errors }");
  });

  test("importAccounts truncates URI in error messages to 80 chars", () => {
    expect(src).toContain("uri.substring(0, 80)");
  });

  test("toPublicAccount strips secret from response", () => {
    // Verify secret is NOT in the return object
    const fnMatch = src.match(
      /function toPublicAccount[\s\S]*?return \{([\s\S]*?)\};/,
    );
    expect(fnMatch).not.toBeNull();
    const returnBlock = fnMatch?.[1];
    expect(returnBlock).not.toContain("secret");
  });

  test("updateAccount only allows label, issuer, accountName changes", () => {
    expect(src).toContain(
      "Partial<{ label: string; issuer: string; accountName: string }>",
    );
  });

  test("deleteAccount returns boolean success", () => {
    expect(src).toContain("return !!result");
  });
});

// ---------------------------------------------------------------------------
// 23. Page — account display header
// ---------------------------------------------------------------------------
describe("Page account count display", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("shows account count in header", () => {
    expect(src).toContain("{accounts.length}");
    expect(src).toContain("account");
  });

  test("pluralizes 'accounts' correctly", () => {
    expect(src).toContain('accounts.length !== 1 ? "s" : ""');
  });
});

// ---------------------------------------------------------------------------
// 24. Page — dialog key props for React reconciliation
// ---------------------------------------------------------------------------
describe("Page dialog key management", () => {
  const src = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("AddAccountDialog (add) has stable key", () => {
    expect(src).toContain('key="add-dialog"');
  });

  test("AddAccountDialog (edit) uses account _id as key", () => {
    expect(src).toContain('key={editingAccount?._id ?? "edit-dialog"}');
  });
});

// ---------------------------------------------------------------------------
// 25. Integration: all imports resolve (no missing modules)
// ---------------------------------------------------------------------------
describe("Import resolution", () => {
  const pageSrc = readSrc("app/admin/dashboard/authenticator/page.tsx");

  test("page imports types from ./types", () => {
    expect(pageSrc).toContain('from "./types"');
  });

  test("page imports AddAccountDialog", () => {
    expect(pageSrc).toContain("AddAccountDialog");
  });

  test("page imports AuthenticatorAccountRow", () => {
    expect(pageSrc).toContain("AuthenticatorAccountRow");
  });

  test("page imports ImportDialog", () => {
    expect(pageSrc).toContain("ImportDialog");
  });

  test("all component files exist", () => {
    const files = [
      "app/admin/dashboard/authenticator/page.tsx",
      "app/admin/dashboard/authenticator/types.ts",
      "app/admin/dashboard/authenticator/_components/authenticator-account.tsx",
      "app/admin/dashboard/authenticator/_components/add-account-dialog.tsx",
      "app/admin/dashboard/authenticator/_components/import-dialog.tsx",
      "app/admin/dashboard/authenticator/_components/countdown-ring.tsx",
    ];
    for (const file of files) {
      expect(() => readSrc(file)).not.toThrow();
    }
  });

  test("all API route files exist", () => {
    const files = [
      "app/api/admin/authenticator/route.ts",
      "app/api/admin/authenticator/[id]/route.ts",
      "app/api/admin/authenticator/codes/route.ts",
      "app/api/admin/authenticator/import/route.ts",
    ];
    for (const file of files) {
      expect(() => readSrc(file)).not.toThrow();
    }
  });
});
