/**
 * Every barcode is stored as a GTIN-14: the digits right-aligned and padded
 * with zeros to fourteen. EAN-8, UPC-A, EAN-13 and GTIN-14 are all the same
 * number at different widths, so a UPC-A printed as `012345678905` and read
 * by a phone as the EAN-13 `0012345678905` resolve to one key.
 *
 * Codes that are not plain GTIN digits (namespaced source ids such as
 * `usda:1234`, store-internal alphanumerics) cannot be normalized and are kept
 * as written; lookups fall back to the alias list for those.
 */

export const GTIN_LENGTH = 14;

const digitsOnly = /^\d+$/;

const clean = (raw: string) => raw.trim().replace(/[\s-]+/g, "");

export const isGtinDigits = (code: string) =>
  digitsOnly.test(code) && code.length <= GTIN_LENGTH;

/** Check digit for the body of a GTIN (every digit except the last). */
export const gtinCheckDigit = (body: string) => {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
};

export const hasValidGtinCheckDigit = (code: string) => {
  if (!digitsOnly.test(code) || code.length < 8 || code.length > GTIN_LENGTH) {
    return false;
  }
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
};

/**
 * UPC-E is a zero-suppressed UPC-A. Phones report it as 6, 7 or 8 digits
 * depending on whether the number system and check digit are included; the
 * product databases store the expanded 12-digit UPC-A.
 */
export const expandUpcE = (code: string): string | undefined => {
  if (!digitsOnly.test(code)) return undefined;

  let numberSystem = "0";
  let body: string;
  let check: string | undefined;

  if (code.length === 6) {
    body = code;
  } else if (code.length === 7) {
    numberSystem = code[0] ?? "0";
    body = code.slice(1);
  } else if (code.length === 8) {
    numberSystem = code[0] ?? "0";
    body = code.slice(1, 7);
    check = code[7];
  } else {
    return undefined;
  }

  if (numberSystem !== "0" && numberSystem !== "1") return undefined;

  const [d1, d2, d3, d4, d5, d6] = [...body];
  if (!d1 || !d2 || !d3 || !d4 || !d5 || !d6) return undefined;

  let manufacturer: string;
  let product: string;
  switch (d6) {
    case "0":
    case "1":
    case "2":
      manufacturer = `${d1}${d2}${d6}00`;
      product = `00${d3}${d4}${d5}`;
      break;
    case "3":
      manufacturer = `${d1}${d2}${d3}00`;
      product = `000${d4}${d5}`;
      break;
    case "4":
      manufacturer = `${d1}${d2}${d3}${d4}0`;
      product = `0000${d5}`;
      break;
    default:
      manufacturer = `${d1}${d2}${d3}${d4}${d5}`;
      product = `0000${d6}`;
  }

  const upcBody = `${numberSystem}${manufacturer}${product}`;
  const computed = String(gtinCheckDigit(upcBody));
  if (check !== undefined && check !== computed) return undefined;

  return `${upcBody}${computed}`;
};

/**
 * The GTIN-14 a code would be if its last digit had been dropped. Padding
 * zeros are stripped first: they do not change the check digit, and an
 * already padded code would otherwise grow past fourteen digits.
 */
const completeCheckDigit = (code: string): string | undefined => {
  if (!isGtinDigits(code) || hasValidGtinCheckDigit(code)) return undefined;
  const body = code.replace(/^0+/, "");
  if (body.length < 7 || body.length > 13) return undefined;
  return normalizeBarcode(`${body}${gtinCheckDigit(body)}`);
};

/** The single key a barcode is stored under. */
export const normalizeBarcode = (raw: string) => {
  const code = clean(raw);
  if (!isGtinDigits(code)) return code;
  return code.padStart(GTIN_LENGTH, "0");
};

/**
 * Keys to try, most likely first, when resolving a scanned or typed code.
 * The normalized form always leads; the rest cover reads that are ambiguous
 * on their own (an 8-digit code may be EAN-8 or UPC-E) and stored codes that
 * were saved without their check digit.
 */
export const barcodeLookupKeys = (raw: string): string[] => {
  const code = clean(raw);
  const keys: string[] = [normalizeBarcode(code)];

  if (isGtinDigits(code)) {
    const upcA = code.length <= 8 ? expandUpcE(code) : undefined;
    if (upcA) {
      const expanded = normalizeBarcode(upcA);
      const isEan8 = code.length === 8 && hasValidGtinCheckDigit(code);
      if (isEan8) keys.push(expanded);
      else keys.unshift(expanded);
    }

    const completed = completeCheckDigit(code);
    if (completed) keys.push(completed);
  }

  if (code !== raw.trim()) keys.push(raw.trim());
  if (!keys.includes(code)) keys.push(code);

  return [...new Set(keys)];
};

/**
 * Additional keys a stored product should answer to besides its normalized
 * barcode. A source code missing its check digit gets the completed form, so
 * a phone (which always reads the check digit) still finds it.
 */
export const barcodeAliases = (stored: string): string[] => {
  const completed = completeCheckDigit(clean(stored));
  return completed ? [completed] : [];
};
