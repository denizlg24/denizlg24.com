import type { Table } from "@/lib/reports/types";

const signedPattern = /^[+−-]\s?[$€£¥]?\d[\d,.]*\s?(%|bp|pp)?$/;

function tone(value: string) {
  if (!signedPattern.test(value.trim())) return undefined;
  return value.trim().startsWith("+") ? "positive" : "negative";
}

const display = (value: string | number | null) =>
  value == null
    ? "—"
    : typeof value === "number"
      ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
          value,
        )
      : value;

export function DocTable({ table }: { table: Table }) {
  const align = (index: number) =>
    table.align?.[index] ??
    (table.rows.every(
      (row) => typeof row[index] === "number" || row[index] == null,
    )
      ? "right"
      : "left");
  return (
    <figure className="doc-table">
      <div className="doc-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {table.columns.map((column, i) => (
                <th
                  key={`${column}-${i}`}
                  className={align(i) === "right" ? "num" : undefined}
                  scope="col"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => {
                  const text = display(cell);
                  const signed =
                    typeof cell === "string" ? tone(cell) : undefined;
                  return (
                    <td
                      key={i}
                      className={
                        [align(i) === "right" ? "num" : "", signed ?? ""]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.caption ? <figcaption>{table.caption}</figcaption> : null}
    </figure>
  );
}
