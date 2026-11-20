"use client";

import { securityFunctions, type SecurityFunction } from "@/lib/terminal";

export type { SecurityFunction };

export function FunctionBar({
  active,
  onSelect,
}: {
  active: SecurityFunction;
  onSelect: (fn: SecurityFunction) => void;
}) {
  return (
    <nav className="function-bar" aria-label="Security functions">
      {securityFunctions.map((item, index) => (
        <button
          key={item.code}
          type="button"
          aria-current={item.code === active ? "page" : undefined}
          title={`${item.label}: ${item.detail}`}
          onClick={() => onSelect(item.code)}
        >
          <span className="fn-index">{index + 1})</span>
          <span className="fn-code">{item.code}</span>
          <span className="fn-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
