const inputs = [
  { name: "SEC EDGAR", note: "Filings, XBRL, Form 4, 13D" },
  { name: "FRED", note: "Every economic series" },
  { name: "U.S. Treasury", note: "Daily yield curve" },
  { name: "Options markets", note: "IV, skew, implied moves" },
  { name: "Fama/French", note: "Factor returns" },
  {
    name: "Interactive Brokers",
    note: "Positions and cash",
    logo: "/brand/interactive-brokers.svg",
  },
  { name: "Your documents", note: "Research, decks, memos" },
  { name: "Market data", note: "Quotes and history" },
] as const;

const outputs = ["Answers", "Charts", "Reports", "Alerts"] as const;

const row = 60;
const height = inputs.length * row;
const middle = height / 2;
const outputRow = height / outputs.length;

function inPath(index: number) {
  const y = index * row + row / 2;
  return `M0 ${y} C 140 ${y}, 160 ${middle}, 300 ${middle}`;
}

function outPath(index: number) {
  const y = index * outputRow + outputRow / 2;
  return `M0 ${middle} C 90 ${middle}, 110 ${y}, 200 ${y}`;
}

export function Converge() {
  return (
    <div className="converge">
      <ul className="converge-inputs">
        {inputs.map((input) => (
          <li key={input.name}>
            {"logo" in input ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={input.logo} alt={input.name} height={15} />
            ) : (
              <strong>{input.name}</strong>
            )}
            <span>{input.note}</span>
          </li>
        ))}
      </ul>
      <svg
        className="converge-lines"
        viewBox={`0 0 300 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {inputs.map((input, index) => (
          <g key={input.name}>
            <path id={`in-${index}`} d={inPath(index)} />
            <circle r="3">
              <animateMotion
                dur="3.2s"
                begin={`${index * 0.4}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#in-${index}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
      </svg>
      <div className="converge-core">
        <svg viewBox="0 0 64 64" aria-hidden>
          <rect width="64" height="64" fill="#174e3a" />
          <g
            fill="none"
            stroke="#f3f8f1"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          >
            <path d="M13 18C22 18 23 34 30 37" opacity=".5" />
            <path d="M13 30C21 30 24 36 30 37" opacity=".72" />
            <path d="M13 46C22 46 24 39 30 37" opacity=".5" />
            <path d="M30 37L38 30L43 34L51 21" strokeWidth="4.2" />
          </g>
          <circle cx="30" cy="37" r="3.4" fill="#f3f8f1" />
          <circle cx="51" cy="21" r="3.4" fill="#f3f8f1" />
        </svg>
        <span>Stockwatcher</span>
      </div>
      <svg
        className="converge-lines converge-out"
        viewBox={`0 0 200 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {outputs.map((output, index) => (
          <g key={output}>
            <path id={`out-${index}`} d={outPath(index)} />
            <circle r="3">
              <animateMotion
                dur="2.4s"
                begin={`${1.6 + index * 0.6}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#out-${index}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
      </svg>
      <ul className="converge-outputs">
        {outputs.map((output) => (
          <li key={output}>{output}</li>
        ))}
      </ul>
    </div>
  );
}
