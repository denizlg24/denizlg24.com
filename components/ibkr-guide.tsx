"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Plus,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Failure } from "./shared";

const portal = "https://www.interactivebrokers.com/portal/";
const queryPattern = /^\d{3,12}$/;
const tokenPattern = /^\d{10,40}$/;

const digits = (text: string) => text.replace(/\D/g, "");

function Mark({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("shot-mark", className)} aria-hidden>
      {n}
    </span>
  );
}

function Shot({ path, children }: { path: string; children: ReactNode }) {
  return (
    <figure className="shot">
      <div className="shot-frame" aria-hidden>
        <div className="shot-chrome">
          <span className="shot-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="shot-url">interactivebrokers.com/portal</span>
        </div>
        <div className="shot-portal">
          <div className="shot-topnav">
            <span className="shot-brand">Client Portal</span>
            <span>Trade</span>
            <span>Portfolio</span>
            <span>Performance &amp; Reports</span>
            <span>Transfer &amp; Pay</span>
          </div>
          <div className="shot-page">
            <p className="shot-crumb">{path}</p>
            {children}
          </div>
        </div>
      </div>
      <figcaption>
        Illustration. IBKR’s page may look slightly different, but the names of
        the buttons are the same.
      </figcaption>
    </figure>
  );
}

function MenuShot() {
  return (
    <figure className="shot">
      <div className="shot-frame" aria-hidden>
        <div className="shot-chrome">
          <span className="shot-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="shot-url">interactivebrokers.com/portal</span>
        </div>
        <div className="shot-portal">
          <div className="shot-topnav">
            <span className="shot-brand">Client Portal</span>
            <span>Trade</span>
            <span>Portfolio</span>
            <span className="shot-hl shot-rel">
              Performance &amp; Reports <ChevronDown size={11} />
              <Mark n={1} className="shot-mark-inline" />
            </span>
            <span>Transfer &amp; Pay</span>
          </div>
          <div className="shot-page shot-page-menu">
            <div className="shot-menu">
              <span>PortfolioAnalyst</span>
              <span>Statements</span>
              <span className="shot-hl shot-rel">
                Flex Queries
                <Mark n={2} className="shot-mark-right" />
              </span>
              <span>Tax Documents</span>
              <span>Third-Party Reports</span>
            </div>
            <div className="shot-ghost">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        Illustration. On a phone or small window, tap <b>Menu</b> (top left),
        then <b>Reporting → Flex Queries</b>.
      </figcaption>
    </figure>
  );
}

function QueryCard({
  title,
  plus,
  rows,
  dim,
  gear,
}: {
  title: string;
  plus?: ReactNode;
  rows?: ReactNode;
  dim?: boolean;
  gear?: ReactNode;
}) {
  return (
    <div className={cn("shot-card", dim && "shot-dim")}>
      <div className="shot-card-head">
        <b>{title}</b>
        {plus ?? gear ?? null}
      </div>
      <div className="shot-card-body">
        {rows ?? <span className="shot-muted">No saved queries</span>}
      </div>
    </div>
  );
}

function NewQueryShot() {
  return (
    <Shot path="Performance & Reports › Flex Queries">
      <div className="shot-grid">
        <QueryCard
          title="Activity Flex Query"
          plus={
            <span className="shot-icon shot-hl shot-rel">
              <Plus size={13} />
              <Mark n={1} className="shot-mark-left" />
            </span>
          }
        />
        <QueryCard
          title="Trade Confirmation Flex Query"
          dim
          plus={
            <span className="shot-icon">
              <Plus size={13} />
            </span>
          }
        />
        <QueryCard
          title="Flex Web Service Configuration"
          dim
          gear={
            <span className="shot-icon">
              <Settings size={12} />
            </span>
          }
          rows={<span className="shot-muted">Status: Disabled</span>}
        />
      </div>
    </Shot>
  );
}

function SectionsShot() {
  const sections = [
    "Account Information",
    "Cash Report",
    "Change in NAV",
    "Open Positions",
    "Trades",
    "Transfers",
  ];
  return (
    <Shot path="Flex Queries › Create Activity Flex Query">
      <div className="shot-form">
        <span className="shot-field">
          <span>Query Name</span>
          <span className="shot-input shot-hl shot-rel">
            Stockwatcher
            <Mark n={1} className="shot-mark-right" />
          </span>
        </span>
        <div className="shot-split">
          <div className="shot-list">
            <span className="shot-label">Sections</span>
            {sections.map((name) => (
              <span
                key={name}
                className={cn(
                  "shot-check",
                  name === "Open Positions" && "shot-hl shot-rel shot-fit",
                  name === "Cash Report" && "shot-optional",
                )}
              >
                <span className="shot-box">
                  {name === "Open Positions" || name === "Cash Report" ? (
                    <Check size={10} />
                  ) : null}
                </span>
                {name}
                {name === "Open Positions" ? (
                  <Mark n={2} className="shot-mark-right" />
                ) : null}
                {name === "Cash Report" ? (
                  <em className="shot-note">optional</em>
                ) : null}
              </span>
            ))}
          </div>
          <div className="shot-popup">
            <b>Open Positions</b>
            <span className="shot-label">Options</span>
            <span className="shot-radio">
              <span className="shot-dot shot-dot-on" /> Summary
              <span className="shot-dot" /> Lot
            </span>
            <span className="shot-check shot-hl shot-rel shot-fit">
              <span className="shot-box">
                <Check size={10} />
              </span>
              Select All
              <Mark n={3} className="shot-mark-right" />
            </span>
            <span className="shot-muted shot-fields">
              Symbol · Quantity · Cost Basis · Currency · Listing Exchange …
            </span>
            <span className="shot-btn shot-btn-primary shot-hl shot-rel shot-fit">
              Save
              <Mark n={4} className="shot-mark-right" />
            </span>
          </div>
        </div>
      </div>
    </Shot>
  );
}

function DeliveryShot() {
  return (
    <Shot path="Flex Queries › Create Activity Flex Query">
      <div className="shot-form">
        <span className="shot-label">Delivery Configuration</span>
        <div className="shot-rows">
          <span className="shot-kv">
            <span>Accounts</span>
            <span className="shot-muted">U•••••••</span>
          </span>
          <span className="shot-kv">
            <span>Format</span>
            <span className="shot-select shot-hl shot-rel">
              XML <ChevronDown size={11} />
              <Mark n={1} className="shot-mark-right" />
            </span>
          </span>
          <span className="shot-kv">
            <span>Period</span>
            <span className="shot-select shot-hl shot-rel">
              Last Business Day <ChevronDown size={11} />
              <Mark n={2} className="shot-mark-right" />
            </span>
          </span>
        </div>
        <span className="shot-label">General Configuration</span>
        <div className="shot-rows shot-dim">
          <span className="shot-kv">
            <span>Date Format</span>
            <span className="shot-select">
              yyyyMMdd <ChevronDown size={11} />
            </span>
          </span>
          <span className="shot-kv">
            <span>Include Canceled Trades?</span>
            <span className="shot-muted">No</span>
          </span>
        </div>
        <div className="shot-actions">
          <span className="shot-btn">Back</span>
          <span className="shot-btn shot-btn-primary shot-hl shot-rel">
            Continue
            <Mark n={3} className="shot-mark-right" />
          </span>
          <span className="shot-then">then</span>
          <span className="shot-btn shot-btn-primary shot-hl shot-rel">
            Create
            <Mark n={4} className="shot-mark-right" />
          </span>
        </div>
      </div>
    </Shot>
  );
}

function QueryIdShot() {
  return (
    <Shot path="Performance & Reports › Flex Queries">
      <div className="shot-grid shot-grid-wide">
        <QueryCard
          title="Activity Flex Query"
          plus={
            <span className="shot-icon">
              <Plus size={13} />
            </span>
          }
          rows={
            <div className="shot-query-row">
              <span>Stockwatcher</span>
              <span className="shot-row-icons">
                <span className="shot-icon shot-hl shot-rel">
                  <Info size={12} />
                  <Mark n={1} className="shot-mark-above" />
                </span>
                <span className="shot-muted">▶ ✎ ✕</span>
              </span>
              <span className="shot-pop">
                <span className="shot-muted">Query details</span>
                <span className="shot-hl shot-rel shot-pop-id">
                  Query ID: <b>1234567</b>
                  <Mark n={2} className="shot-mark-right" />
                </span>
                <span className="shot-muted">Type: Activity · Format: XML</span>
              </span>
            </div>
          }
        />
      </div>
    </Shot>
  );
}

function GearShot() {
  return (
    <Shot path="Performance & Reports › Flex Queries">
      <div className="shot-grid">
        <QueryCard
          title="Activity Flex Query"
          dim
          rows={<span>Stockwatcher</span>}
        />
        <QueryCard title="Trade Confirmation Flex Query" dim />
        <QueryCard
          title="Flex Web Service Configuration"
          gear={
            <span className="shot-icon shot-hl shot-rel">
              <Settings size={12} />
              <Mark n={1} className="shot-mark-below" />
            </span>
          }
          rows={<span className="shot-muted">Status: Disabled</span>}
        />
      </div>
    </Shot>
  );
}

function TokenShot() {
  return (
    <Shot path="Flex Queries › Flex Web Service Configuration">
      <div className="shot-form shot-narrow">
        <span className="shot-kv">
          <span>Flex Web Service Status</span>
          <span className="shot-toggle shot-hl shot-rel">
            <span />
            <Mark n={1} className="shot-mark-right" />
          </span>
        </span>
        <span className="shot-kv">
          <span>Expires after</span>
          <span className="shot-select shot-hl shot-rel">
            1 year <ChevronDown size={11} />
            <Mark n={2} className="shot-mark-right" />
          </span>
        </span>
        <span className="shot-kv">
          <span>Valid for IP address</span>
          <span className="shot-muted">(leave empty)</span>
        </span>
        <span className="shot-btn shot-hl shot-rel shot-self-start">
          Generate A New Token
          <Mark n={3} className="shot-mark-right" />
        </span>
        <span className="shot-kv">
          <span>Current Token</span>
          <span className="shot-token shot-hl shot-rel">
            833145478193195254070598
            <Mark n={4} className="shot-mark-right" />
          </span>
        </span>
      </div>
    </Shot>
  );
}

type Step = {
  rail: string;
  title: string;
  body: ReactNode;
  shot?: ReactNode;
  field?: "queryId" | "token";
};

const steps: Step[] = [
  {
    rail: "Before you start",
    title: "Link your Interactive Brokers account",
    body: (
      <>
        <p>
          This takes about five minutes and you only do it once. After that,
          Stockwatcher updates your positions every few hours.
        </p>
        <ul className="guide-points">
          <li>
            <ShieldCheck size={16} />
            <span>
              <b>Read-only.</b> Stockwatcher can see your positions and cash. It
              cannot place trades, move money, or change anything in your
              account.
            </span>
          </li>
          <li>
            <Check size={16} />
            <span>
              You will copy <b>two numbers</b> from the IBKR website into this
              window: a <b>Query ID</b> and a <b>token</b>.
            </span>
          </li>
          <li>
            <Check size={16} />
            <span>
              Keep this window open. Open IBKR in a new tab with the button
              below, then switch back and forth.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    rail: "Open Flex Queries",
    title: "Log in to IBKR and open Flex Queries",
    body: (
      <ol className="guide-actions">
        <li>
          Log in to the IBKR <b>Client Portal</b> with your usual username and
          password.
        </li>
        <li>
          <Mark n={1} /> At the top, click <b>Performance &amp; Reports</b>.
        </li>
        <li>
          <Mark n={2} /> In the menu that opens, click <b>Flex Queries</b>.
        </li>
      </ol>
    ),
    shot: <MenuShot />,
  },
  {
    rail: "Start a new query",
    title: "Start a new Activity Flex Query",
    body: (
      <ol className="guide-actions">
        <li>
          The Flex Queries page has several boxes. Find the one called{" "}
          <b>Activity Flex Query</b>.
        </li>
        <li>
          <Mark n={1} /> Click the <b>+</b> sign at its top right corner.
        </li>
      </ol>
    ),
    shot: <NewQueryShot />,
  },
  {
    rail: "Choose Open Positions",
    title: "Name it and choose Open Positions",
    body: (
      <ol className="guide-actions">
        <li>
          <Mark n={1} /> In <b>Query Name</b>, type <b>Stockwatcher</b>.
        </li>
        <li>
          <Mark n={2} /> Under <b>Sections</b>, click <b>Open Positions</b>. A
          small window opens.
        </li>
        <li>
          <Mark n={3} /> In that window, tick <b>Select All</b>. Leave{" "}
          <b>Summary</b> selected.
        </li>
        <li>
          <Mark n={4} /> Click <b>Save</b>.
        </li>
        <li className="guide-optional">
          Optional: also click <b>Cash Report</b>, tick <b>Select All</b> and
          click <b>Save</b> to see your cash balances.
        </li>
      </ol>
    ),
    shot: <SectionsShot />,
  },
  {
    rail: "Format and period",
    title: "Choose XML and Last Business Day, then create it",
    body: (
      <ol className="guide-actions">
        <li>
          Scroll down to <b>Delivery Configuration</b>.
        </li>
        <li>
          <Mark n={1} /> Set <b>Format</b> to <b>XML</b>.
        </li>
        <li>
          <Mark n={2} /> Set <b>Period</b> to <b>Last Business Day</b>.
        </li>
        <li>Leave everything else as it is.</li>
        <li>
          <Mark n={3} /> Click <b>Continue</b> at the bottom. <Mark n={4} /> On
          the review page, click <b>Create</b>.
        </li>
      </ol>
    ),
    shot: <DeliveryShot />,
  },
  {
    rail: "Copy the Query ID",
    title: "Copy the Query ID",
    body: (
      <ol className="guide-actions">
        <li>
          You are back on the Flex Queries page. <b>Stockwatcher</b> now appears
          under Activity Flex Query.
        </li>
        <li>
          <Mark n={1} /> Click the small <b>ⓘ</b> (information) icon next to it.
        </li>
        <li>
          <Mark n={2} /> Copy the <b>Query ID</b> number and paste it below.
        </li>
      </ol>
    ),
    shot: <QueryIdShot />,
    field: "queryId",
  },
  {
    rail: "Open token settings",
    title: "Open the Flex Web Service settings",
    body: (
      <ol className="guide-actions">
        <li>
          On the same Flex Queries page, find the box called{" "}
          <b>Flex Web Service Configuration</b>.
        </li>
        <li>
          <Mark n={1} /> Click the <b>gear</b> icon in its corner.
        </li>
      </ol>
    ),
    shot: <GearShot />,
  },
  {
    rail: "Copy the token",
    title: "Turn it on and copy the token",
    body: (
      <ol className="guide-actions">
        <li>
          <Mark n={1} /> Switch <b>Flex Web Service Status</b> on.
        </li>
        <li>
          <Mark n={2} /> Choose the longest expiry offered, so you rarely need
          to repeat this.
        </li>
        <li>
          <Mark n={3} /> Click <b>Generate A New Token</b>. Leave the IP address
          empty.
        </li>
        <li>
          <Mark n={4} /> Copy the long number shown as the token and paste it
          below.
        </li>
      </ol>
    ),
    shot: <TokenShot />,
    field: "token",
  },
  {
    rail: "Connect",
    title: "Connect",
    body: (
      <p>
        Stockwatcher will check the two numbers with Interactive Brokers and
        load your positions. This usually takes 10 to 30 seconds.
      </p>
    ),
  },
];

export const tokenStep = steps.findIndex((step) => step.field === "token");
const queryStep = steps.findIndex((step) => step.field === "queryId");

export function IbkrGuide({
  close,
  connect,
  initialQueryId = "",
  startAt = 0,
}: {
  close: () => void;
  connect: (input: { token: string; queryId: string }) => Promise<void>;
  initialQueryId?: string;
  startAt?: number;
}) {
  const [index, setIndex] = useState(startAt);
  const [queryId, setQueryId] = useState(initialQueryId);
  const [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const queryOk = queryPattern.test(queryId);
  const tokenOk = tokenPattern.test(token);
  const canAdvance =
    step.field === "queryId"
      ? queryOk
      : step.field === "token"
        ? tokenOk
        : last
          ? queryOk && tokenOk && !working
          : true;

  const go = (next: number) => {
    setError(undefined);
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  };

  const submit = async () => {
    setWorking(true);
    setError(undefined);
    try {
      await connect({ token, queryId });
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Unable to connect."),
      );
    } finally {
      setWorking(false);
    }
  };

  const next = () => {
    if (!canAdvance) return;
    if (last) void submit();
    else go(index + 1);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) close();
      }}
    >
      <DialogContent
        className="ibkr-guide sm:max-w-[1080px]"
        showCloseButton={!working}
      >
        <nav className="guide-rail" aria-label="Setup steps">
          <p className="guide-rail-head">Connect Interactive Brokers</p>
          <ol>
            {steps.map((item, i) => (
              <li key={item.rail}>
                <button
                  type="button"
                  aria-current={i === index ? "step" : undefined}
                  className={cn(i < index && "done")}
                  disabled={working}
                  onClick={() => go(i)}
                >
                  <span className="guide-num">
                    {i < index ? <Check size={12} /> : i + 1}
                  </span>
                  {item.rail}
                </button>
              </li>
            ))}
          </ol>
          <a
            className="guide-portal"
            href={portal}
            target="_blank"
            rel="noreferrer"
          >
            Open IBKR Client Portal <ExternalLink size={13} />
          </a>
        </nav>
        <form
          className="guide-main"
          onSubmit={(event) => {
            event.preventDefault();
            next();
          }}
        >
          <div className="guide-progress" aria-hidden>
            <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <p className="guide-count">
            Step {index + 1} of {steps.length}
          </p>
          <DialogTitle className="guide-title">{step.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="guide-body">{step.body}</div>
          </DialogDescription>
          {index === 0 ? (
            <Button asChild variant="outline" className="guide-open">
              <a href={portal} target="_blank" rel="noreferrer">
                Open IBKR Client Portal in a new tab <ExternalLink />
              </a>
            </Button>
          ) : null}
          {step.shot}
          {step.field === "queryId" ? (
            <label className="guide-input">
              <span>Query ID</span>
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                placeholder="For example 1234567"
                value={queryId}
                onChange={(event) => setQueryId(digits(event.target.value))}
              />
              <small className={cn(queryId && !queryOk && "guide-bad")}>
                {queryId && !queryOk
                  ? "That doesn’t look right. The Query ID is a number of about 6 to 7 digits."
                  : "Only the number. Letters and spaces are removed for you."}
              </small>
            </label>
          ) : null}
          {step.field === "token" ? (
            <label className="guide-input">
              <span>Token</span>
              <Input
                autoFocus
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Paste the long number"
                value={token}
                onChange={(event) => setToken(digits(event.target.value))}
              />
              <small className={cn(token && !tokenOk && "guide-bad")}>
                {token && !tokenOk
                  ? "That looks too short. The token is a long number, usually about 24 digits."
                  : "Treat it like a password. Stockwatcher stores it encrypted."}
              </small>
            </label>
          ) : null}
          {last ? (
            <dl className="guide-summary">
              <div>
                <dt>Query ID</dt>
                <dd>
                  {queryOk ? (
                    queryId
                  ) : (
                    <button type="button" onClick={() => go(queryStep)}>
                      Missing. Go to step {queryStep + 1}
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>
                  {tokenOk ? (
                    `•••• ${token.slice(-4)}`
                  ) : (
                    <button type="button" onClick={() => go(tokenStep)}>
                      Missing. Go to step {tokenStep + 1}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          <Failure error={error} />
          {error && last ? (
            <p className="guide-help">
              If IBKR says the token or query is invalid, check that the Flex
              Web Service is switched on and that you copied the newest token. A
              token you just generated can take a few minutes to start working.
            </p>
          ) : null}
          <div className="guide-footer">
            <Button
              type="button"
              variant="ghost"
              disabled={index === 0 || working}
              onClick={() => go(index - 1)}
            >
              <ArrowLeft /> Back
            </Button>
            <Button type="submit" size="lg" disabled={!canAdvance}>
              {last ? (
                working ? (
                  "Connecting…"
                ) : (
                  "Connect and sync"
                )
              ) : (
                <>
                  {index === 0 ? "Start" : "Next"} <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
