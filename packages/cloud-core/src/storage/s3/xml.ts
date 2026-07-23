import { S3Error } from "./errors";

export function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, name: string) => {
      const normalized = name.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function elementValue(xml: string, name: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

export function parseDeleteObjects(xml: string): {
  keys: string[];
  quiet: boolean;
} {
  const keys = [...xml.matchAll(/<Object(?:\s[^>]*)?>([\s\S]*?)<\/Object>/gi)]
    .map((match) => elementValue(match[1] ?? "", "Key"))
    .filter((key): key is string => key !== undefined);
  if (keys.length === 0) {
    throw new S3Error(
      "MalformedXML",
      "The XML you provided was not well-formed.",
      400,
    );
  }
  return {
    keys,
    quiet: elementValue(xml, "Quiet")?.toLowerCase() === "true",
  };
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export function parseCompletedParts(xml: string): CompletedPart[] {
  const parts = [...xml.matchAll(/<Part(?:\s[^>]*)?>([\s\S]*?)<\/Part>/gi)].map(
    (match) => {
      const partXml = match[1] ?? "";
      const partNumber = Number.parseInt(
        elementValue(partXml, "PartNumber") ?? "",
        10,
      );
      const etag = elementValue(partXml, "ETag")?.replace(/^"|"$/g, "");
      if (!Number.isInteger(partNumber) || partNumber < 1 || !etag) {
        throw new S3Error(
          "MalformedXML",
          "The XML you provided was not well-formed.",
          400,
        );
      }
      return { partNumber, etag };
    },
  );
  if (parts.length === 0) {
    throw new S3Error(
      "MalformedXML",
      "The XML you provided was not well-formed.",
      400,
    );
  }
  return parts;
}
