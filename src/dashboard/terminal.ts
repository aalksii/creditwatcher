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
  const title = c(ANSI.bold, `${name} (${plan})`);
  if (provider.cached) {
    return `${title}${c(ANSI.dim, " cached")}`;
  }
  return title;
}

function formatRefreshNotice(provider: ProviderQuota): string | undefined {
  const seconds =
    provider.secondsUntilRefresh ?? provider.cooldownSeconds;
  if (seconds == null) return undefined;

  if (seconds > 0) {
    return `Next refresh in ${formatDuration(seconds)}`;
  }

  if (provider.nextRefreshAt) {
    return `Refresh available at ${new Date(provider.nextRefreshAt).toLocaleTimeString()}`;
  }

  return undefined;
}

function formatWindowLine(
  w: ProviderQuota["windows"][number],
  dimmed = false,
): string {
  const label = shortWindowLabel(w.label).padEnd(3);
  const bar = dimmed
    ? c(ANSI.dim, progressBar(w.usedPercent))
    : colorBar(w.usedPercent);
  const pct = dimmed
    ? c(ANSI.dim, formatPercent(w.usedPercent))
    : c(percentColor(w.usedPercent), formatPercent(w.usedPercent));
  let line = `${label} ${bar} ${pct}`;

  if (w.resetAfterSeconds != null && w.resetAfterSeconds > 0) {
    line += c(ANSI.dim, ` ↻${formatDuration(w.resetAfterSeconds)}`);
  }

  return line;
}

function providerBody(provider: ProviderQuota, colWidth: number): string[] {
  const lines: string[] = [];
  const dimmed = provider.cached === true;

  if (provider.status === "not_connected") {
    lines.push(c(ANSI.dim, truncate(provider.loginHint ?? "Not logged in", colWidth)));
    return lines;
  }

  if (provider.authSource) {
    lines.push(
      c(ANSI.dim, truncate(`Auth: ${shortenPath(provider.authSource)}`, colWidth)),
    );
  }

  const refreshNotice = formatRefreshNotice(provider);
  if (refreshNotice) {
    lines.push(c(ANSI.dim, truncate(refreshNotice, colWidth)));
  }

  if (provider.status === "error" && provider.error) {
    lines.push(c(ANSI.yellow, truncate(provider.error, colWidth)));
  } else if (
    provider.status === "cooldown" &&
    provider.error &&
    !provider.cached
  ) {
    lines.push(c(ANSI.yellow, truncate(provider.error, colWidth)));
  }

  if (provider.windows.length === 0) {
    if (provider.status === "ok") {
      lines.push(c(ANSI.dim, "No usage windows"));
    }
    return lines;
  }

  for (const w of provider.windows) {
    lines.push(truncate(formatWindowLine(w, dimmed), colWidth));
  }

  if (provider.credits?.hasCredits || provider.credits?.balance) {
    const credits =
      provider.credits.unlimited
        ? "Credits: unlimited"
        : provider.credits.balance != null
          ? `Credits: ${provider.credits.balance}`
          : "Credits: available";
    lines.push(
      c(dimmed ? ANSI.dim : ANSI.cyan, truncate(credits, colWidth)),
    );
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

export function formatProviderStatusBlock(provider: ProviderQuota): string {
  const name = provider.provider === "codex" ? "Codex" : "Claude";
  const plan = provider.plan ?? "unknown";
  const cachedLabel = provider.cached ? " (cached)" : "";
  const lines: string[] = [`${name} usage — ${plan}${cachedLabel}`];

  if (provider.authSource) {
    lines.push(`Auth: ${provider.authSource}`);
  }

  const refreshNotice = formatRefreshNotice(provider);
  if (refreshNotice) {
    lines.push(refreshNotice);
  }

  if (lines.length > 1 || provider.windows.length > 0) {
    lines.push("");
  }

  for (const w of provider.windows) {
    const bar = progressBar(w.usedPercent);
    const used = w.usedPercent.toFixed(1);
    const remain = w.remainingPercent.toFixed(1);
    let line = `${w.label.padEnd(14)} ${bar} ${used}% used (${remain}% left)`;
    if (w.resetAfterSeconds != null && w.resetAfterSeconds > 0) {
      line += ` · resets in ${formatDuration(w.resetAfterSeconds)}`;
    } else if (w.resetAt) {
      line += ` · resets at ${new Date(w.resetAt).toLocaleString()}`;
    }
    lines.push(line);
  }

  if (provider.credits?.hasCredits || provider.credits?.balance) {
    lines.push("");
    if (provider.credits.unlimited) {
      lines.push("Credits: unlimited");
    } else if (provider.credits.balance != null) {
      lines.push(`Credits balance: ${provider.credits.balance}`);
    }
  }

  for (const warning of provider.warnings) {
    lines.push(`⚠️  ${warning}`);
  }

  return lines.join("\n");
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
