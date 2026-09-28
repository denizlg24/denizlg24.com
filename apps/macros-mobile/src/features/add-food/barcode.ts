/**
 * GTIN check digit (EAN-8, UPC-A, EAN-13). A read that fails it is a misread,
 * not a product, so it is ignored and scanning carries on. UPC-E carries the
 * check digit of its expanded form and is taken as read.
 */
export function isPlausibleBarcode(code: string, type: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (type === "upc_e") return code.length === 6 || code.length === 8;
  if (![8, 12, 13].includes(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );
  return (10 - (sum % 10)) % 10 === check;
}
