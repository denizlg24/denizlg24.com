"use client";

import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

type Step = {
  hash?: string;
  element?: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
};

const steps: Step[] = [
  {
    hash: "desk",
    title: "Welcome to Stockwatcher",
    description:
      "A terminal-style desk for markets, research and your book. This tour walks through every part of it in about two minutes. Use ← → or the buttons; Esc ends it, and you can replay it any time with <kbd>TOUR</kbd> or from HELP.",
  },
  {
    element: ".command-line",
    title: "Command line",
    description:
      "Everything starts here. Type a ticker and a function, then Enter: <kbd>NVDA DES</kbd>, <kbd>AAPL GP</kbd>. Monitors take tickers too: <kbd>CORR SPY TLT GLD</kbd>. A function's number (<kbd>12</kbd>) opens it for the security on screen, ↑ recalls earlier commands, and <kbd>/</kbd> focuses it from anywhere.",
    side: "bottom",
  },
  {
    element: ".panel-tabs",
    title: "Panel tabs",
    description:
      "Keep several functions open at once, each with its own security. <kbd>Alt T</kbd> opens a copy of this panel, <kbd>Alt W</kbd> closes it, <kbd>Alt ←/→</kbd> or <kbd>Alt 1–9</kbd> switch.",
    side: "bottom",
  },
  {
    element: ".topbar-tape",
    title: "Market tape",
    description: "Benchmarks streaming across the top, with live quotes when the feed is on.",
    side: "bottom",
  },
  {
    element: ".global-search",
    title: "Search",
    description: "Find any stock, ETF, index, future, currency or crypto by name or ticker. <kbd>⌘/Ctrl K</kbd>.",
    side: "bottom",
  },
  {
    element: ".ask-button",
    title: "Assistant",
    description:
      "Ask in plain language — it builds dashboards, reports, slide decks and alerts, and remembers what matters to you (Memory). <kbd>⌘/Ctrl J</kbd> toggles it.",
    side: "bottom",
  },
  {
    hash: "desk",
    element: ".desk-toolbar",
    title: "Desk",
    description:
      "Your launchpad: morning brief, holdings, movers, watchlists, charts, news, alerts, heat maps, notes — and any terminal function (GC, RRG, CORR, TOP, EVTS, PRSK, FXC, CMDTY, CRYP, GRID) as a widget. Edit desk to add, resize and reorder.",
    side: "bottom",
  },
  {
    hash: "security?ticker=AAPL&fn=GP",
    element: ".function-bar",
    title: "Security functions",
    description:
      "Fifteen functions per security: GP chart, DES profile, FA financials, ANR analysts, ERN earnings, HDS holders, MGMT, DVD dividends, RELS relationships, SPLC supply chain, CN news, HVT volatility, BETA, SEAS seasonality and BTST backtests. Click one or type its number.",
    side: "bottom",
  },
  {
    element: ".chart-toolbar",
    title: "Chart controls",
    description:
      "Period, chart type (line, mountain, candles, hollow, bars, Heikin-Ashi), 20+ studies, saved Templates, custom moving averages of any period (MAs), custom oscillator Panes, linear/log/% scale, Style (grid, crosshair, colours, dividends, alert lines), export to PNG/SVG/CSV and full screen. Save as default keeps it.",
    side: "bottom",
  },
  {
    element: ".studio-tools",
    title: "Drawing tools",
    description:
      "Trend lines, rays, levels, vertical lines, boxes, Fibonacci, channels, notes, a measure tool and an eraser — saved per symbol. The bell sets a price alert at the level you click. Shortcuts: <kbd>⇧T</kbd> <kbd>⇧F</kbd> <kbd>⇧H</kbd> <kbd>⇧A</kbd>…, <kbd>Esc</kbd> for the cursor.",
    side: "bottom",
  },
  {
    element: ".studio-compare",
    title: "Compare",
    description: "Overlay up to four other tickers, rebased to the first visible bar, e.g. <kbd>SPY</kbd> or <kbd>QQQ</kbd>.",
    side: "left",
  },
  {
    element: ".price-chart-stack",
    title: "The chart",
    description:
      "Wheel to zoom, drag to pan, double-click to reset. The readout tracks the bar under the cursor. D and S markers are dividends and splits; dashed gold lines are your alerts.",
    side: "top",
  },
  {
    hash: "security?ticker=NVDA&fn=SPLC",
    element: ".graph-toolbar",
    title: "Supply chain network",
    description:
      "Customers, suppliers, partners and competitors from SEC filings. Lay it out as a chain, radial, force or by sector; colour by day move, position, degree or a demand Shock that flows up the chain by revenue share; filter by relationship, share and degree; compare with a second company to see shared counterparties.",
    side: "bottom",
  },
  {
    element: ".graph-frame",
    title: "Explore the graph",
    description:
      "Drag companies, zoom and pan. Double-click a listed company to pull in its own suppliers and customers. Export to SVG, PNG or CSV. Your layout and expansions are remembered.",
    side: "right",
  },
  {
    element: ".graph-inspector",
    title: "Inspect and annotate",
    description:
      "Select a company to see its quote, every relationship with the quoted filing sentence, and its route to the centre company. Add your own relationships with a revenue share and note.",
    side: "left",
  },
  {
    hash: "security?ticker=AAPL&fn=BTST",
    element: ".quant-params",
    title: "Quant tools",
    description:
      "BTST backtests crossover, RSI, breakout and momentum rules with costs and shorts. HVT shows realised volatility and its percentile, BETA regresses against any benchmark, SEAS shows monthly seasonality.",
    side: "bottom",
  },
  {
    hash: "monitor?fn=MOST",
    element: ".function-bar",
    title: "Monitors",
    description:
      "Market-wide functions: MOST actives, WEI world indices, ECO economics, GC Treasury curve, FXC currency matrix, CMDTY commodities, CRYP crypto, CORR correlations, EQS screener, RRG rotation, GRID chart grid, PRSK portfolio risk, TOP news wire and EVTS earnings calendar.",
    side: "bottom",
  },
  {
    hash: "monitor?fn=EQS",
    element: ".eqs-filters",
    title: "Equity screener",
    description:
      "Screen the S&P 500 by sector, price, day and period moves, 52-week position and turnover. Save screens, then send the results to CORR or a G overlay.",
    side: "right",
  },
  {
    hash: "monitor?fn=RRG",
    element: ".rrg",
    title: "Relative rotation",
    description: "Which sectors, regions, factors or asset classes are leading, weakening, lagging or improving against a benchmark.",
    side: "top",
  },
  {
    hash: "monitor?fn=PRSK",
    element: ".function-bar",
    title: "Portfolio risk",
    description:
      "PRSK turns your recorded positions into VaR, expected shortfall, beta, drawdown, per-position risk contribution and a stress table, valued in USD.",
    side: "bottom",
  },
  {
    hash: "overlay",
    element: ".overlay-builder",
    title: "G · overlay charts",
    description:
      "Overlay any tickers, FRED macro series and expressions like <kbd>NVDA/AMD</kbd> on left, right or separate axes, rebased or z-scored. Save charts and pin them to the desk.",
    side: "bottom",
  },
  {
    hash: "markets",
    element: '.sidebar a[href="#markets"]',
    title: "Markets",
    description: "Heat maps for market groups and a relative-performance comparison of up to six symbols.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#portfolio"]',
    title: "Portfolio",
    description: "Books of trades with average cost, realised and unrealised P&L per currency.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#research"]',
    title: "Research",
    description: "Company profiles, SEC filings, social sentiment and your research journal.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#watchlists"]',
    title: "Watchlists",
    description: "Dense quote monitors for any number of lists.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#reports"]',
    title: "Reports",
    description: "Reports and slide decks the assistant writes, shareable by link.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#alerts"]',
    title: "Alerts",
    description: "Price alerts checked in the background, including those set from charts.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#memory"]',
    title: "Memory",
    description: "What the assistant has learned about you, which you can edit or delete.",
    side: "right",
  },
  {
    element: '.sidebar a[href="#settings"]',
    title: "Settings",
    description: "Theme (including a terminal theme), home view, live refresh and chart defaults.",
    side: "right",
  },
  {
    title: "Function keys",
    description:
      "<kbd>F1</kbd> help · <kbd>F2</kbd> GC · <kbd>F3</kbd> TOP · <kbd>F4</kbd> EVTS · <kbd>F6</kbd> MOST · <kbd>F7</kbd> PRSK · <kbd>F8</kbd> EQS · <kbd>F9</kbd> commodities · <kbd>F10</kbd> WEI · <kbd>F11</kbd> FXC. Press <kbd>?</kbd> for the full keyboard map.",
  },
  {
    hash: "desk",
    title: "You're set",
    description: "Type <kbd>TOUR</kbd> or use HELP to see this again. Start with a ticker in the command line.",
  },
];

function navigate(hash: string | undefined) {
  if (hash && window.location.hash.slice(1) !== hash) window.location.hash = hash;
}

export function startTour(onFinish: () => void) {
  const driveSteps: DriveStep[] = steps.map((step) => ({
    ...(step.element ? { element: step.element } : {}),
    data: { hash: step.hash },
    popover: {
      title: step.title,
      description: step.description,
      ...(step.side ? { side: step.side, align: "start" as const } : {}),
    },
  }));
  const hashFor = (index: number) => {
    for (let i = index; i >= 0; i--) if (steps[i]?.hash) return steps[i].hash;
    return undefined;
  };
  const tour = driver({
    steps: driveSteps,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    allowClose: true,
    smoothScroll: true,
    stagePadding: 4,
    stageRadius: 4,
    overlayOpacity: 0.55,
    popoverClass: "sw-tour",
    waitForElement: 9000,
    skipMissingElement: true,
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Done",
    onNextClick: (_element, _step, { driver: active }) => {
      if (active.isLastStep()) {
        active.destroy();
        return;
      }
      navigate(hashFor((active.getActiveIndex() ?? 0) + 1));
      active.moveNext();
    },
    onPrevClick: (_element, _step, { driver: active }) => {
      navigate(hashFor((active.getActiveIndex() ?? 1) - 1));
      active.movePrevious();
    },
    onDestroyed: () => onFinish(),
  });
  navigate(steps[0].hash);
  tour.drive();
  return tour;
}
