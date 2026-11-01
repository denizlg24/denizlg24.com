/**
 * Data access for custom UI specs (`@repo/schemas` workspace-components):
 * dot paths into a scope and `{{path | pipe}}` placeholders in text.
 */

export type SpecScope = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `a.b.0.c`, `rows.length`; undefined anywhere along the way is undefined. */
export function getPath(scope: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return scope;
  let current: unknown = scope;
  for (const part of trimmed.split(".")) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      if (part === "length") current = current.length;
      else if (/^\d+$/.test(part)) current = current[Number(part)];
      else return undefined;
    } else if (typeof current === "string" && part === "length") {
      current = current.length;
    } else if (isRecord(current)) {
      current = Object.hasOwn(current, part) ? current[part] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/** `path` or `!path`. */
export function evalWhen(expression: string, scope: SpecScope): boolean {
  const negate = expression.trim().startsWith("!");
  const value = truthy(getPath(scope, expression.trim().replace(/^!/, "")));
  return negate ? !value : value;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function applyPipe(value: unknown, pipe: string): unknown {
  const [name, ...args] = pipe.split(":").map((part) => part.trim());
  const arg = args.join(":");
  switch (name) {
    case "number": {
      const n = asNumber(value);
      return n === null ? value : n.toLocaleString();
    }
    case "fixed": {
      const n = asNumber(value);
      return n === null ? value : n.toFixed(Number(arg) || 0);
    }
    case "percent": {
      const n = asNumber(value);
      return n === null ? value : `${Math.round(n * 100)}%`;
    }
    case "currency": {
      const n = asNumber(value);
      if (n === null) return value;
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: arg || "EUR",
        }).format(n);
      } catch {
        return n.toFixed(2);
      }
    }
    case "minor": {
      const n = asNumber(value);
      return n === null ? value : n / 100;
    }
    case "date": {
      if (typeof value !== "string" && typeof value !== "number") return value;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(arg === "long" ? { weekday: "short", year: "numeric" } : {}),
      });
    }
    case "upper":
      return typeof value === "string" ? value.toUpperCase() : value;
    case "lower":
      return typeof value === "string" ? value.toLowerCase() : value;
    case "default":
      return value === undefined || value === null || value === ""
        ? arg
        : value;
    case "count":
    case "length":
      return Array.isArray(value)
        ? value.length
        : typeof value === "string"
          ? value.length
          : 0;
    case "json":
      return JSON.stringify(value);
    default:
      return value;
  }
}

/** Evaluates `path | pipe | pipe:arg`. */
export function evalExpression(expression: string, scope: SpecScope): unknown {
  const [path = "", ...pipes] = expression.split("|");
  let value = getPath(scope, path);
  for (const pipe of pipes) value = applyPipe(value, pipe);
  return value;
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Replaces each `{{ expression }}`; a template that is exactly one placeholder keeps its value's type. */
export function interpolate(template: string, scope: SpecScope): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expression: string) =>
    display(evalExpression(expression, scope)),
  );
}

/** The raw value of a template that is a single placeholder, else its interpolated text. */
export function resolveValue(template: string, scope: SpecScope): unknown {
  const single = template.match(/^\s*\{\{([^}]+)\}\}\s*$/);
  return single?.[1] !== undefined
    ? evalExpression(single[1], scope)
    : interpolate(template, scope);
}

export function resolveNumber(
  template: string,
  scope: SpecScope,
): number | null {
  return asNumber(resolveValue(template, scope));
}

/** Whole days from `today` (YYYY-MM-DD) to `target`; negative once passed. */
export function daysUntil(target: string, today: string): number | null {
  const a = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${target.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
