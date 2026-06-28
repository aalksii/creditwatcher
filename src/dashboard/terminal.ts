import { homedir } from "node:os";
import type { ProviderQuota, QuotaResponse } from "../server/quota.js";
import { formatDuration, progressBar } from "../utils.js";

const BOX_WIDTH = 68;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR != null) return true;
  return process.stdout.isTTY === true;
}

function c(code: string, text: string): string {
  return colorsEnabled() ? `${code}${text}${ANSI.reset}` : text;
}

function percentColor(usedPercent: number): string {
  if (usedPercent > 90) return ANSI.red;
  if (usedPercent >= 70) return ANSI.yellow;
  return ANSI.green;
}

function colorBar(usedPercent: number, width = 10): string {
  const bar = progressBar(usedPercent, width);
  return c(percentColor(usedPercent), bar);
}

function formatPercent(usedPercent: number): string {
  const rounded = Math.round(usedPercent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function shortWindowLabel(label: string): string {
  switch (label) {
    case "5-hour":
      return "5h";
    case "weekly":
      return "wk";
    case "7-day":
      return "7d";
    case "7-day Sonnet":
      return "7dS";
    case "7-day Opus":
      return "7dO";
    default:
      return label.length <= 4 ? label : label.slice(0, 4);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

function providerTitle(provider: ProviderQuota): string {
  const name = provider.provider === "codex" ? "Codex" : "Claude";
  if (provider.status === "not_connected") {
    return c(ANSI.dim, `${name} — not connected`);
  }
  const plan = provider.plan ?? "unknown";
  return c(ANSI.bold, `${name} (${plan})`);
}

function formatWindowLine(w: ProviderQuota["windows"][number]): string {
  const label = shortWindowLabel(w.label).padEnd(3);
  const bar = colorBar(w.usedPercent);
  const pct = c(percentColor(w.usedPercent), formatPercent(w.usedPercent));
  let line = `${label} ${bar} ${pct}`;

  if (w.resetAfterSeconds != null && w.resetAfterSeconds > 0) {
    line += c(ANSI.dim, ` ↻${formatDuration(w.resetAfterSeconds)}`);
  }

  return line;
}

function providerBody(provider: ProviderQuota, colWidth: number): string[] {
  const lines: string[] = [];

  if (provider.status === "not_connected") {
    lines.push(c(ANSI.dim, truncate(provider.loginHint ?? "Not logged in", colWidth)));
    return lines;
  }

  if (provider.authSource) {
    lines.push(
      c(ANSI.dim, truncate(`Auth: ${shortenPath(provider.authSource)}`, colWidth)),
    );
  }

  if (provider.status === "cooldown" || provider.status === "error") {
    if (provider.error) {
      lines.push(c(ANSI.yellow, truncate(provider.error, colWidth)));
    }
  }

  if (provider.windows.length === 0) {
    if (provider.status === "ok") {
      lines.push(c(ANSI.dim, "No usage windows"));
    }
    return lines;
  }

  for (const w of provider.windows) {
    lines.push(truncate(formatWindowLine(w), colWidth));
  }

  if (provider.credits?.hasCredits || provider.credits?.balance) {
    const credits =
      provider.credits.unlimited
        ? "Credits: unlimited"
        : provider.credits.balance != null
          ? `Credits: ${provider.credits.balance}`
          : "Credits: available";
    lines.push(c(ANSI.cyan, truncate(credits, colWidth)));
  }

  for (const warning of provider.warnings) {
    lines.push(c(ANSI.yellow, truncate(`⚠ ${warning}`, colWidth)));
  }

  return lines;
}

function joinColumns(left: string[], right: string[], colWidth: number): string[] {
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];

  for (let i = 0; i < rows; i++) {
    const l = (left[i] ?? "").padEnd(colWidth);
    const r = (right[i] ?? "").padEnd(colWidth);
    out.push(`│ ${l} │ ${r} │`);
  }

  return out;
}

function topBorder(title: string): string {
  const label = `─ ${title} `;
  const dashes = "─".repeat(Math.max(0, BOX_WIDTH - label.length));
  return `┌${label}${dashes}┐`;
}

function bottomBorder(): string {
  return `└${"─".repeat(BOX_WIDTH)}┘`;
}

function headerRow(left: string, right: string, colWidth: number): string {
  return `│ ${left.padEnd(colWidth)} │ ${right.padEnd(colWidth)} │`;
}

export function renderDashboard(quota: QuotaResponse): string {
  const inner = BOX_WIDTH - 2;
  const colWidth = Math.floor((inner - 3) / 2);

  const leftTitle = providerTitle(quota.codex);
  const rightTitle = providerTitle(quota.claude);
  const leftBody = providerBody(quota.codex, colWidth);
  const rightBody = providerBody(quota.claude, colWidth);

  const lines: string[] = [
    topBorder("CreditWatcher"),
    headerRow(leftTitle, rightTitle, colWidth),
    ...joinColumns(leftBody, rightBody, colWidth),
    bottomBorder(),
  ];

  const updated = c(
    ANSI.dim,
    `Updated ${new Date(quota.fetchedAt).toLocaleTimeString()}`,
  );
  lines.push(updated);

  return lines.join("\n");
}
