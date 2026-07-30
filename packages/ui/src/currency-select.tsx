"use client";

import { useMemo } from "react";
import { SearchSelect, type SearchSelectOption } from "./search-select";

/**
 * ISO 4217 codes worth offering. Deliberately not the full ~180: the list is
 * what a personal ledger realistically holds, led by the currencies the ECB
 * publishes rates for (see `apps/web/lib/finance/fx.ts`) so a picked currency
 * actually converts. Names come from `Intl.DisplayNames`.
 */
const CURRENCY_CODES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "AUD",
  "CAD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "TRY",
  "ISK",
  "ILS",
  "HKD",
  "SGD",
  "KRW",
  "CNY",
  "INR",
  "IDR",
  "MYR",
  "PHP",
  "THB",
  "ZAR",
  "BRL",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "AED",
  "SAR",
  "QAR",
  "MAD",
  "EGP",
  "NGN",
  "KES",
  "UAH",
  "RSD",
  "HRK",
];

export function useCurrencyOptions(
  codes = CURRENCY_CODES,
): SearchSelectOption[] {
  return useMemo(() => {
    const names = new Intl.DisplayNames(["en"], { type: "currency" });
    return codes.map((code) => {
      const name = names.of(code) ?? code;
      return {
        value: code,
        label: `${code} · ${name}`,
        // The control often sits in a narrow slot beside an amount, where
        // "USD · US Dollar" only ever renders as "USD · US …".
        triggerLabel: code,
        keywords: `${code} ${name}`,
      };
    });
  }, [codes]);
}

export function CurrencySelect({
  value,
  onValueChange,
  codes,
  disabled,
  className,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  codes?: string[];
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const options = useCurrencyOptions(codes);
  return (
    <SearchSelect
      id={id}
      aria-label="Currency"
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder="Currency"
      searchPlaceholder="Search currencies"
      emptyLabel="No currency"
      disabled={disabled}
      className={className}
    />
  );
}
