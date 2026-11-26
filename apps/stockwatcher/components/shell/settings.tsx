"use client";

import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Failure } from "@/components/shared";
import { Field, value, type Save } from "@/components/forms";
import type { Workspace } from "@/lib/models";
import { homeOptions } from "./nav";
import { chartStyleLabels, chartStyles } from "@/lib/models";
import { rangeKeys } from "@/lib/universes";
import { studies, studyKeys } from "@/lib/indicators";

const studyGroups = [...new Set(studies.map((item) => item.group))];

export type Account = {
  name: string;
  email: string | null;
  demo: boolean;
  admin?: boolean;
};

export function Settings({
  workspace,
  account,
  save,
}: {
  workspace: Workspace;
  account: Account;
  save: Save;
}) {
  const chart = workspace.settings.chart;
  const [error, setError] = useState<Error>();
  const [success, setSuccess] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setWorking(true);
    setError(undefined);
    setSuccess("");
    try {
      await save((current) => ({
        ...current,
        settings: {
          theme: value(fields, "theme") as Workspace["settings"]["theme"],
          home: value(fields, "home") as Workspace["settings"]["home"],
          refresh: fields.has("refresh"),
          baseCurrency: value(fields, "baseCurrency").toUpperCase(),
          chart: {
            ...current.settings.chart,
            style: chartStyles.find((item) => item === value(fields, "style")) ?? "area",
            range: rangeKeys.find((item) => item === value(fields, "range")) ?? "1M",
            studies: studyKeys
              .filter((key) => fields.has(`study-${key}`))
              .slice(0, 12),
            log: fields.has("log"),
            scale: fields.has("log")
              ? "log"
              : current.settings.chart.scale === "percent"
                ? "percent"
                : undefined,
          },
        },
      }));
      setSuccess("Preferences saved.");
    } catch (error) {
      setError(error as Error);
    } finally {
      setWorking(false);
    }
  }
  function exportWorkspace() {
    const backup = {
      format: "stockwatcher",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `stockwatcher-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Preferences</h2>
            <p>Saved to your workspace.</p>
          </div>
        </div>
        <form className="form-stack settings-form" onSubmit={submit}>
          <Field label="Appearance">
            <select name="theme" defaultValue={workspace.settings.theme}>
              <option value="system">Follow device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="terminal">Terminal (amber on black)</option>
            </select>
          </Field>
          <Field label="Opening view">
            <select name="home" defaultValue={workspace.settings.home}>
              {homeOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base currency">
            <input
              name="baseCurrency"
              defaultValue={workspace.settings.baseCurrency}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              title="Three-letter ISO currency code, e.g. USD, EUR, GBP"
              required
            />
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              name="refresh"
              defaultChecked={workspace.settings.refresh}
            />{" "}
            Automatically refresh visible quotes
          </label>
          <fieldset className="chart-defaults">
            <legend>Chart defaults</legend>
            <Field label="Chart type">
              <select name="style" defaultValue={chart.style}>
                {chartStyles.map((style) => (
                  <option key={style} value={style}>
                    {chartStyleLabels[style]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default period">
              <select name="range" defaultValue={chart.range}>
                {rangeKeys.map((range) => (
                  <option key={range} value={range}>
                    {range}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check-field">
              <input type="checkbox" name="log" defaultChecked={chart.log} />{" "}
              Logarithmic price scale
            </label>
            {studyGroups.map((group) => (
              <div key={group} className="study-defaults">
                <span>{group}</span>
                {studies
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <label
                      key={item.key}
                      className="check-field"
                      title={item.description}
                    >
                      <input
                        type="checkbox"
                        name={`study-${item.key}`}
                        defaultChecked={chart.studies.includes(item.key)}
                      />{" "}
                      {item.label}
                    </label>
                  ))}
              </div>
            ))}
          </fieldset>
          <Failure error={error} />
          {success ? (
            <p className="positive" role="status">
              {success}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={working}>
              {working ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Account</h2>
            <p>{account.demo ? "Preview workspace" : "Deniz Cloud"}</p>
          </div>
        </div>
        <div className="account-detail">
          <strong>{account.name}</strong>
          {account.email ? <span>{account.email}</span> : null}
          <form action="/auth/logout" method="post">
            <Button variant="outline" type="submit">
              <LogOut /> Sign out
            </Button>
          </form>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Workspace backup</h2>
            <p>
              Download a copy of your watchlists, portfolios, research, and
              alerts.
            </p>
          </div>
        </div>
        <div className="account-detail">
          <Button
            className="justify-self-start"
            variant="outline"
            onClick={exportWorkspace}
          >
            Download workspace JSON
          </Button>
        </div>
      </section>
    </div>
  );
}
