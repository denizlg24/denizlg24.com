import {
  arrow,
  price,
  repeatText,
  signed,
  signedPercent,
  triggerRows,
  utc,
} from "./compose";
import type { Detail, Message, Tone, Trigger } from "./types";

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const listing = (trigger: Trigger) =>
  trigger.exchange ? `${trigger.name} · ${trigger.exchange}` : trigger.name;

const dayLine = (trigger: Trigger) =>
  trigger.day
    ? `${arrow(trigger.day.change > 0 ? "up" : trigger.day.change < 0 ? "down" : "info")} ${signed(trigger.day.change)} (${signedPercent(trigger.day.percent)}) today`
    : null;

const lastLine = (trigger: Trigger) =>
  `${price(trigger.price)} ${trigger.currency}`;

/* ── Plain text: the email alternative part, WhatsApp, ntfy ───────── */

function triggerText(trigger: Trigger, bold: (text: string) => string) {
  return [
    `${bold(`${trigger.symbol}  ${lastLine(trigger)}`)}${dayLine(trigger) ? `  ${dayLine(trigger)}` : ""}`,
    listing(trigger),
    `${trigger.ruleText}.`,
    ...triggerRows(trigger)
      .filter((row) => row.label !== "Day change")
      .map((row) => `${row.label}: ${row.value}`),
    ...(trigger.note ? [`Note: ${trigger.note}`] : []),
  ].join("\n");
}

export function plainText(message: Message, bold = (text: string) => text) {
  const blocks = [
    `${message.kicker.toUpperCase()} · ${utc(message.time)}`,
    bold(message.title),
    message.summary,
    ...message.triggers.map((trigger) => triggerText(trigger, bold)),
  ];
  if (message.details.length)
    blocks.push(
      message.details.map((row) => `${row.label}: ${row.value}`).join("\n"),
    );
  if (message.body) blocks.push(message.body);
  if (message.triggers.length === 1 && message.triggers[0])
    blocks.push(repeatText(message.triggers[0]));
  blocks.push(`${message.action}: ${message.url}`);
  return blocks.join("\n\n");
}

export const emailText = (message: Message) =>
  [
    plainText(message),
    "—",
    message.reason,
    ...(message.manageUrl
      ? [`Manage alerts and channels: ${message.manageUrl}`]
      : []),
  ].join("\n\n");

/** CallMeBot takes the text in a query string, so WhatsApp gets the short form. */
export const whatsappText = (message: Message) =>
  [
    `*${message.title}*`,
    shortText(message),
    `${message.action}: ${message.url}`,
  ].join("\n\n");

/** ntfy and browser push show a few lines at most, so keep to the figures that matter. */
export function shortText(message: Message) {
  if (!message.triggers.length) return message.summary;
  if (message.triggers.length > 1)
    return message.triggers
      .map(
        (trigger) =>
          `${trigger.symbol} ${lastLine(trigger)}${trigger.day ? ` (${signedPercent(trigger.day.percent)})` : ""} · ${trigger.rule}`,
      )
      .join("\n");
  const [trigger] = message.triggers;
  if (!trigger) return message.summary;
  return [
    `${trigger.name}: ${lastLine(trigger)}${trigger.day ? `, ${signedPercent(trigger.day.percent)} today` : ""}`,
    `${trigger.ruleText}${trigger.beyond ? ` (${trigger.beyond})` : ""}`,
    ...(trigger.note ? [trigger.note] : []),
  ].join("\n");
}

export const pushPayload = (message: Message) => ({
  title: message.title,
  body: clip(shortText(message), 240),
  url: message.url,
  tone: message.tone,
});

/* ── Telegram (HTML parse mode) ─────────────────────────────────── */

export function telegramHtml(message: Message) {
  const e = escapeHtml;
  const parts = [
    `<b>${e(message.title)}</b>`,
    `<i>${e(message.kicker)} · ${e(utc(message.time))}</i>`,
  ];
  if (message.triggers.length !== 1) parts.push(e(message.summary));
  for (const trigger of message.triggers) {
    const rows = triggerRows(trigger).filter(
      (row) => row.label !== "Day change" && row.label !== "Market data",
    );
    parts.push(
      [
        `<b>${e(trigger.symbol)}  ${e(lastLine(trigger))}</b>${dayLine(trigger) ? `  ${e(dayLine(trigger) ?? "")}` : ""}`,
        e(listing(trigger)),
        `${e(trigger.ruleText)}.`,
        "",
        ...rows.map((row) => `${e(row.label)}: <b>${e(row.value)}</b>`),
        ...(trigger.note
          ? ["", `<blockquote>${e(trigger.note)}</blockquote>`]
          : []),
        `<i>${e(utc(trigger.quotedAt))} · ${e(trigger.source)}</i>`,
        message.triggers.length > 1
          ? `<a href="${e(trigger.url)}">Open ${e(trigger.symbol)} chart</a>`
          : "",
      ]
        .filter((line, index, all) => line !== "" || all[index - 1] !== "")
        .join("\n")
        .trim(),
    );
  }
  if (message.details.length)
    parts.push(
      message.details
        .map((row) => `${e(row.label)}: <b>${e(row.value)}</b>`)
        .join("\n"),
    );
  if (message.body) parts.push(e(message.body));
  if (message.triggers.length === 1 && message.triggers[0])
    parts.push(`<i>${e(repeatText(message.triggers[0]))}</i>`);
  parts.push(`<a href="${e(message.url)}">${e(message.action)}</a>`);
  const text = parts.join("\n\n");
  return text.length <= 4000
    ? text
    : `<b>${e(message.title)}</b>\n\n${e(clip(shortText(message), 3500))}\n\n<a href="${e(message.url)}">${e(message.action)}</a>`;
}

/* ── Discord (embeds) ───────────────────────────────────────────── */

const toneColour: Record<Tone, number> = {
  up: 0x1b6e45,
  down: 0xb0342f,
  info: 0x174e3a,
};

export function discordPayload(message: Message) {
  const footer = { text: message.reason };
  const embeds = message.triggers.length
    ? message.triggers.slice(0, 10).map((trigger) => ({
        author: { name: clip(listing(trigger), 256) },
        title: clip(`${trigger.symbol} ${lastLine(trigger)}`, 256),
        url: trigger.url,
        description: clip(
          [
            dayLine(trigger),
            `**${trigger.ruleText}**`,
            ...(trigger.note ? [`> ${trigger.note}`] : []),
          ]
            .filter(Boolean)
            .join("\n"),
          4096,
        ),
        color: toneColour[trigger.tone],
        fields: triggerRows(trigger)
          .filter(
            (row) => row.label !== "Day change" && row.label !== "Market data",
          )
          .map((row) => ({
            name: row.label,
            value: clip(row.value, 1024),
            inline: true,
          })),
        footer: { text: `${trigger.source} · ${repeatText(trigger)}` },
        timestamp: trigger.quotedAt,
      }))
    : [
        {
          title: clip(message.title, 256),
          url: message.url,
          description: clip(
            [message.summary, message.body].filter(Boolean).join("\n\n"),
            4096,
          ),
          color: toneColour[message.tone],
          fields: message.details.slice(0, 25).map((row) => ({
            name: row.label,
            value: clip(row.value, 1024),
            inline: row.value.length < 40,
          })),
          footer,
          timestamp: message.time,
        },
      ];
  return {
    username: "Stockwatcher",
    content: clip(
      `**${message.kicker}** · ${message.triggers.length > 1 ? message.summary : message.title}`,
      2000,
    ),
    embeds,
    allowed_mentions: { parse: [] },
  };
}

/* ── Slack (Block Kit) ──────────────────────────────────────────── */

const slackEscape = (text: string) =>
  text.replace(/[&<>]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;",
  );

const slackFields = (rows: Detail[]) =>
  rows.slice(0, 10).map((row) => ({
    type: "mrkdwn",
    text: clip(`*${slackEscape(row.label)}*\n${slackEscape(row.value)}`, 2000),
  }));

export function slackPayload(message: Message) {
  const s = slackEscape;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: clip(message.title, 150) },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${s(message.kicker)} · ${s(utc(message.time))}`,
        },
      ],
    },
  ];
  if (message.triggers.length !== 1)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clip(s(message.summary), 3000) },
    });
  for (const trigger of message.triggers.slice(0, 8)) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: clip(
            [
              `*<${trigger.url}|${s(trigger.symbol)}>*  ${s(listing(trigger))}`,
              `*${s(lastLine(trigger))}*${dayLine(trigger) ? `  ${s(dayLine(trigger) ?? "")}` : ""}`,
              s(trigger.ruleText),
              ...(trigger.note ? [`>${s(trigger.note)}`] : []),
            ].join("\n"),
            3000,
          ),
        },
        fields: slackFields(
          triggerRows(trigger).filter(
            (row) => row.label !== "Day change" && row.label !== "Market data",
          ),
        ),
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: s(
              `Market data ${utc(trigger.quotedAt)} · ${trigger.source} · ${repeatText(trigger)}`,
            ),
          },
        ],
      },
    );
  }
  if (message.details.length)
    blocks.push({ type: "section", fields: slackFields(message.details) });
  if (message.body)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clip(s(message.body), 3000) },
    });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: clip(message.action, 75) },
        url: message.url,
        style: "primary",
      },
    ],
  });
  return { text: `${message.title} — ${message.summary}`, blocks };
}

/* ── Email (table layout, inline styles) ────────────────────────── */

const ink = "#121814";
const muted = "#566059";
const paper = "#f5f5ef";
const rule = "#dcddd4";
const ruleStrong = "#1f2622";
const forest = "#174e3a";
const colour: Record<Tone, string> = {
  up: "#1b6e45",
  down: "#b0342f",
  info: ink,
};
const toneClass: Record<Tone, string> = {
  up: "sw-gain",
  down: "sw-loss",
  info: "sw-ink",
};
const sans =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const serif = "Newsreader,Georgia,'Times New Roman',serif";
const numeric = "font-variant-numeric:tabular-nums;white-space:nowrap";

const darkCss = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .sw-bg{background:#111412!important}
  .sw-ink{color:#e6ebe5!important}
  .sw-muted{color:#9aa49d!important}
  .sw-gain{color:#6ccf95!important}
  .sw-loss{color:#ff958c!important}
  .sw-rule{border-color:#272e29!important}
  .sw-strong{border-color:#6b756e!important}
  .sw-quote{border-color:#6b756e!important;color:#e6ebe5!important}
  .sw-track{background:#272e29!important}
  .sw-marker{background:#e6ebe5!important}
  .sw-btn{background:#a7d7b4!important}
  .sw-btn a{color:#111412!important}
  .sw-link{color:#a7d7b4!important}
}
@media (max-width:480px){
  .sw-pad{padding:24px 16px!important}
  .sw-hero{font-size:24px!important}
  .sw-price{font-size:22px!important}
}`;

function detailRows(rows: Detail[]) {
  return rows
    .map(
      (row) => `<tr>
<td class="sw-muted sw-rule" style="padding:7px 12px 7px 0;border-bottom:1px solid ${rule};color:${muted};font-size:13px;vertical-align:top">${escapeHtml(row.label)}</td>
<td class="${toneClass[row.tone ?? "info"]} sw-rule" align="right" style="padding:7px 0;border-bottom:1px solid ${rule};color:${colour[row.tone ?? "info"]};font-size:13px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(row.value)}</td>
</tr>`,
    )
    .join("");
}

/** Where the last price sits between the day's low and high, as a hairline track. */
function rangeBar(trigger: Trigger) {
  const span = trigger.dayRange;
  if (!span || span.high <= span.low) return "";
  const at = Math.round(
    Math.min(
      1,
      Math.max(0, (trigger.price - span.low) / (span.high - span.low)),
    ) * 100,
  );
  const left = Math.min(99, at);
  const cell = (width: number) =>
    width > 0
      ? `<td class="sw-track" width="${width}%" style="width:${width}%;height:3px;background:${rule};font-size:0;line-height:0">&nbsp;</td>`
      : "";
  return `<tr><td colspan="2" style="padding:16px 0 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${cell(left)}<td class="sw-marker" width="1%" style="width:1%;height:11px;background:${ink};font-size:0;line-height:0">&nbsp;</td>${cell(99 - left)}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="sw-muted" style="padding-top:5px;font-size:11px;color:${muted};${numeric}">Low ${price(span.low)}</td>
<td class="sw-muted" align="center" style="padding-top:5px;font-size:11px;color:${muted};text-transform:uppercase;letter-spacing:.075em">Day range</td>
<td class="sw-muted" align="right" style="padding-top:5px;font-size:11px;color:${muted};${numeric}">High ${price(span.high)}</td>
</tr></table>
</td></tr>`;
}

function triggerHtml(trigger: Trigger, linked: boolean) {
  const e = escapeHtml;
  const dayTone: Tone = trigger.day
    ? trigger.day.change > 0
      ? "up"
      : trigger.day.change < 0
        ? "down"
        : "info"
    : "info";
  const bar = rangeBar(trigger);
  const rows = triggerRows(trigger).filter(
    (row) => row.label !== "Day change" && !(bar && row.label === "Day range"),
  );
  return `<tr><td style="padding-top:28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sw-strong" style="border-top:1px solid ${ruleStrong}">
<tr>
<td valign="top" style="padding-top:14px">
<div class="sw-ink" style="font-size:17px;font-weight:700;color:${ink};letter-spacing:-.01em">${linked ? `<a href="${e(trigger.url)}" class="sw-ink" style="color:${ink};text-decoration:none">${e(trigger.symbol)}</a>` : e(trigger.symbol)}</div>
<div class="sw-muted" style="padding-top:2px;font-size:13px;color:${muted}">${e(listing(trigger))}</div>
</td>
<td valign="top" align="right" style="padding-top:12px;text-align:right">
<div class="sw-ink sw-price" style="font-size:26px;font-weight:600;color:${ink};letter-spacing:-.02em;${numeric}">${e(price(trigger.price))}<span class="sw-muted" style="font-size:13px;font-weight:500;color:${muted};letter-spacing:0"> ${e(trigger.currency)}</span></div>
${trigger.day ? `<div class="${toneClass[dayTone]}" style="padding-top:2px;font-size:13px;font-weight:600;color:${colour[dayTone]};${numeric}">${e(dayLine(trigger) ?? "")}</div>` : ""}
</td>
</tr>
<tr><td colspan="2" style="padding-top:16px">
<div class="sw-ink" style="font-size:15px;font-weight:600;line-height:1.45;color:${ink}">${e(trigger.ruleText)}</div>
${trigger.beyond ? `<div class="sw-muted" style="padding-top:2px;font-size:13px;color:${muted}">Now ${e(trigger.reading)}, ${e(trigger.beyond)}</div>` : ""}
</td></tr>
${bar}
<tr><td colspan="2" style="padding-top:12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(rows)}</table>
</td></tr>
${trigger.note ? `<tr><td colspan="2" style="padding-top:16px"><div class="sw-quote" style="border-left:2px solid ${ruleStrong};padding:2px 0 2px 12px;font-size:14px;line-height:1.5;color:${ink}">${e(trigger.note)}</div></td></tr>` : ""}
<tr><td colspan="2" class="sw-muted" style="padding-top:12px;font-size:12px;line-height:1.5;color:${muted}">${e(repeatText(trigger))}${linked ? ` <a href="${e(trigger.url)}" class="sw-link" style="color:${forest};font-weight:600;text-decoration:none">Open ${e(trigger.symbol)} chart&nbsp;→</a>` : ""}</td></tr>
</table>
</td></tr>`;
}

export function emailHtml(message: Message, logoUrl: string | null) {
  const e = escapeHtml;
  const linked = message.triggers.length > 1;
  const preheader = `${e(clip(message.summary, 140))}${"&#847;&zwnj;&nbsp;".repeat(40)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(message.title)}</title>
<style>${darkCss}</style>
</head>
<body class="sw-bg" style="margin:0;padding:0;background:${paper};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sw-bg" style="background:${paper}">
<tr><td align="center" class="sw-pad" style="padding:32px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${sans};color:${ink}">
<tr><td style="padding-bottom:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="font-size:14px;font-weight:700;letter-spacing:-.01em">${logoUrl ? `<img src="${e(logoUrl)}" width="20" height="20" alt="" style="display:inline-block;vertical-align:-5px;border:0;border-radius:4px;margin-right:8px">` : ""}<span class="sw-ink" style="color:${ink}">Stockwatcher</span></td>
<td valign="middle" align="right" class="sw-muted" style="font-size:12px;color:${muted};${numeric}">${e(utc(message.time))}</td>
</tr></table>
</td></tr>
<tr><td class="sw-strong" style="border-top:1px solid ${ruleStrong};padding-top:12px">
<div class="${message.tone === "info" ? "sw-muted" : toneClass[message.tone]}" style="font-size:11px;font-weight:650;letter-spacing:.075em;text-transform:uppercase;color:${message.tone === "info" ? muted : colour[message.tone]}">${e(message.kicker)}</div>
<h1 class="sw-ink sw-hero" style="margin:8px 0 0;font-family:${serif};font-size:30px;font-weight:500;line-height:1.15;letter-spacing:-.02em;color:${ink}">${e(message.title)}</h1>
<p class="sw-ink" style="margin:10px 0 0;font-size:15px;line-height:1.55;color:${ink}">${e(message.summary)}</p>
</td></tr>
${message.triggers.map((trigger) => triggerHtml(trigger, linked)).join("\n")}
${message.details.length ? `<tr><td style="padding-top:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sw-strong" style="border-top:1px solid ${ruleStrong}">${detailRows(message.details)}</table></td></tr>` : ""}
${message.body ? `<tr><td class="sw-ink" style="padding-top:20px;font-size:15px;line-height:1.6;color:${ink};white-space:pre-line">${e(message.body)}</td></tr>` : ""}
<tr><td style="padding-top:28px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="sw-btn" style="background:${forest};border-radius:3px"><a href="${e(message.url)}" style="display:inline-block;padding:12px 20px;font-family:${sans};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${e(message.action)}</a></td>
</tr></table>
</td></tr>
<tr><td style="padding-top:32px">
<div class="sw-rule" style="border-top:1px solid ${rule};padding-top:14px;font-size:12px;line-height:1.6;color:${muted}">
<span class="sw-muted" style="color:${muted}">${e(message.reason)}${message.manageUrl ? ` Change which alerts reach this address, or stop them, under <a href="${e(message.manageUrl)}" class="sw-link" style="color:${forest};text-decoration:underline">Alerts</a>.` : ""}${message.triggers.length ? " Prices may be delayed and are for information only, not advice to trade." : ""}</span>
</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** The webhook body keeps the original fields and adds the structured ones. */
export function webhookPayload(message: Message, sentAt: string) {
  const [first] = message.triggers;
  const data: Record<string, string> = {};
  if (message.triggers.length === 1 && first) {
    data.Symbol = first.symbol;
    data.Last = lastLine(first);
    for (const row of triggerRows(first)) data[row.label] = row.value;
  }
  for (const row of message.details) data[row.label] = row.value;
  return {
    event: "stockwatcher.alert",
    sentAt,
    title: message.title,
    body: message.summary,
    url: message.url,
    tone: message.tone,
    data,
    kicker: message.kicker,
    time: message.time,
    triggers: message.triggers,
    details: message.details,
    text: message.body,
  };
}
