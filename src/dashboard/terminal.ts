import { homedir } from "node:os";
import type { DisplayOptions } from "../display-options.js";
import { formatAuthLines } from "../display-options.js";
import type { ProviderQuota, QuotaResponse } from "../server/quota.js";
import {
  formatDuration,
  padVisible,
  progressBar,
  truncateVisible,
} from "../utils.js";

const BOX_WIDTH = 68;
const CONTENT_INDENT = 2;

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
    case "included":
      return "inc";
    case "on-demand":
      return "od";
    default:
      return label.length <= 4 ? label : label.slice(0, 4);
  }
}

function providerDisplayName(provider: ProviderQuota["provider"]): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
    default:
      return provider;
  }
}

function providerTitle(provider: ProviderQuota): string {
  const name = providerDisplayName(provider.provider);
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

const WINDOW_LABEL_WIDTH = 3;
const WINDOW_BAR_WIDTH = 10;
const WINDOW_PCT_WIDTH = 5;

function formatWindowLine(
  w: ProviderQuota["windows"][number],
  dimmed = false,
): string {
  const label = shortWindowLabel(w.label).padEnd(WINDOW_LABEL_WIDTH);
  const bar = dimmed
    ? c(ANSI.dim, progressBar(w.usedPercent, WINDOW_BAR_WIDTH))
    : colorBar(w.usedPercent, WINDOW_BAR_WIDTH);
  const pctText = formatPercent(w.usedPercent).padStart(WINDOW_PCT_WIDTH);
  const pct = dimmed
    ? c(ANSI.dim, pctText)
    : c(percentColor(w.usedPercent), pctText);
  let line = `${label} ${bar} ${pct}`;

  if (w.resetAfterSeconds != null && w.resetAfterSeconds > 0) {
    line += c(ANSI.dim, ` ↻ ${formatDuration(w.resetAfterSeconds)}`);
  }

  return line;
}

function contentWidth(): number {
  return BOX_WIDTH - 2 - CONTENT_INDENT;
}

function boxLine(text: string): string {
  const width = contentWidth();
  const content = padVisible(truncateVisible(text, width), width);
  return `│${" ".repeat(CONTENT_INDENT)}${content}│`;
}

function emptyBoxLine(): string {
  return `│${" ".repeat(BOX_WIDTH - 2)}│`;
}

function providerBody(
  provider: ProviderQuota,
  options: DisplayOptions = {},
  authToken?: string,
): string[] {
  const lines: string[] = [];
  const dimmed = provider.cached === true;

  if (provider.status === "not_connected") {
    lines.push(c(ANSI.dim, provider.loginHint ?? "Not logged in"));
    return lines;
  }

  for (const authLine of formatAuthLines(
    provider.authSource ? shortenPath(provider.authSource) : undefined,
    authToken,
    options,
  )) {
    lines.push(c(ANSI.dim, authLine));
  }

  if (provider.status === "error" && provider.error) {
    lines.push(c(ANSI.yellow, provider.error));
  } else if (
    provider.status === "cooldown" &&
    provider.error &&
    !provider.cached
  ) {
    lines.push(c(ANSI.yellow, provider.error));
  }

  if (provider.windows.length === 0) {
    if (provider.status === "ok") {
      lines.push(c(ANSI.dim, "No usage windows"));
    }
    return lines;
  }

  for (const w of provider.windows) {
    lines.push(formatWindowLine(w, dimmed));
  }

  if (provider.credits?.hasCredits || provider.credits?.balance) {
    const credits =
      provider.credits.unlimited
        ? "Credits: unlimited"
        : provider.credits.balance != null
          ? `Credits: ${provider.credits.balance}`
          : "Credits: available";
    lines.push(c(dimmed ? ANSI.dim : ANSI.cyan, credits));
  }

  for (const warning of provider.warnings) {
    lines.push(c(ANSI.yellow, `⚠ ${warning}`));
  }

  return lines;
}

function renderProviderSection(
  provider: ProviderQuota,
  options: DisplayOptions = {},
  authToken?: string,
): string[] {
  const lines = [providerTitle(provider), ...providerBody(provider, options, authToken)];
  return lines.map((line) => boxLine(line));
}

function getProviders(quota: QuotaResponse): ProviderQuota[] {
  return [quota.codex, quota.claude, quota.cursor];
}

function minSecondsUntilRefresh(providers: ProviderQuota[]): number | undefined {
  const values = providers
    .map((p) => p.secondsUntilRefresh ?? p.cooldownSeconds)
    .filter((s): s is number => s != null && s > 0);
  return values.length > 0 ? Math.min(...values) : undefined;
}

function topBorder(title: string): string {
  const inner = BOX_WIDTH - 2;
  const label = `─ ${title} `;
  const dashes = "─".repeat(Math.max(0, inner - label.length));
  return `┌${label}${dashes}┐`;
}

function bottomBorder(): string {
  return `└${"─".repeat(BOX_WIDTH - 2)}┘`;
}

function providerSeparator(): string {
  const dashes = "─".repeat(contentWidth());
  return boxLine(dashes);
}

export function formatProviderStatusBlock(
  provider: ProviderQuota,
  options: DisplayOptions = {},
  authToken?: string,
): string {
  const name = providerDisplayName(provider.provider);
  const plan = provider.plan ?? "unknown";
  const cachedLabel = provider.cached ? " (cached)" : "";
  const lines: string[] = [`${name} usage — ${plan}${cachedLabel}`];

  lines.push(
    ...formatAuthLines(provider.authSource, authToken, options),
  );

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

export interface DashboardRenderOptions extends DisplayOptions {
  authTokens?: Partial<Record<ProviderQuota["provider"], string>>;
}

export function renderDashboard(
  quota: QuotaResponse,
  options: DashboardRenderOptions = {},
): string {
  const providers = getProviders(quota);
  const sections: string[] = [
    topBorder("CreditWatcher"),
    emptyBoxLine(),
  ];

  for (let i = 0; i < providers.length; i++) {
    if (i > 0) {
      sections.push(emptyBoxLine());
      sections.push(providerSeparator());
      sections.push(emptyBoxLine());
    }
    const provider = providers[i];
    sections.push(
      ...renderProviderSection(
        provider,
        options,
        options.authTokens?.[provider.provider],
      ),
    );
  }

  sections.push(emptyBoxLine());
  sections.push(bottomBorder());

  const updated = `Updated ${new Date(quota.fetchedAt).toLocaleTimeString()}`;
  const refreshSeconds = minSecondsUntilRefresh(providers);
  const footer =
    refreshSeconds != null
      ? `${updated} · Next refresh in ${formatDuration(refreshSeconds)}`
      : updated;

  sections.push(c(ANSI.dim, footer));

  return sections.join("\n");
}
