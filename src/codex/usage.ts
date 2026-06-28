import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { USAGE_MIN_INTERVAL_SEC, USAGE_URL, USER_AGENT } from "../constants.js";
import type { DisplayOptions } from "../display-options.js";
import { formatAuthLines } from "../display-options.js";
import type { Credentials, UsageResponse, UsageSnapshot, WindowSnapshot } from "../types.js";
import {
  clampPercent,
  formatDuration,
  formatWindowLabel,
  progressBar,
  usageCooldownWaitSeconds,
  usageFetchedAtNow,
} from "../utils.js";

const CACHE_FILE = join(homedir(), ".creditwatcher", "usage-cache.json");

interface UsageCache {
  fetchedAt: number;
}

async function readCache(): Promise<UsageCache | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as UsageCache;
  } catch {
    return null;
  }
}

async function writeCache(): Promise<void> {
  await mkdir(join(homedir(), ".creditwatcher"), { recursive: true, mode: 0o700 });
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ fetchedAt: usageFetchedAtNow() }),
    { mode: 0o600 },
  );
}

export async function fetchUsage(
  creds: Credentials,
  options: { force?: boolean } = {},
): Promise<UsageSnapshot> {
  if (!options.force) {
    const cache = await readCache();
    if (cache) {
      const wait = usageCooldownWaitSeconds(
        cache.fetchedAt,
        USAGE_MIN_INTERVAL_SEC,
      );
      if (wait != null) {
        throw new Error(
          `Usage was checked recently. Wait ${wait}s before checking again (max once per ${USAGE_MIN_INTERVAL_SEC}s).`,
        );
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  if (creds.accountId) {
    headers["ChatGPT-Account-Id"] = creds.accountId;
  }

  const res = await fetch(USAGE_URL, { method: "GET", headers });
  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `Usage request failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  let data: UsageResponse;
  try {
    data = JSON.parse(body) as UsageResponse;
  } catch {
    throw new Error("Usage endpoint returned invalid JSON");
  }

  await writeCache();
  return snapshotFromResponse(data);
}

function windowSnapshot(
  window: NonNullable<UsageResponse["rate_limit"]>["primary_window"],
  label: string,
): WindowSnapshot | undefined {
  if (!window) return undefined;

  const usedPercent = window.used_percent ?? 0;
  const resetAt =
    window.reset_at != null
      ? new Date(window.reset_at * 1000)
      : window.reset_after_seconds != null
        ? new Date(Date.now() + window.reset_after_seconds * 1000)
        : undefined;

  return {
    label,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt,
    resetAfterSeconds: window.reset_after_seconds,
    windowSeconds: window.limit_window_seconds,
  };
}

export function snapshotFromResponse(data: UsageResponse): UsageSnapshot {
  const primaryLabel = formatWindowLabel(
    data.rate_limit?.primary_window?.limit_window_seconds,
  );
  const secondaryLabel = formatWindowLabel(
    data.rate_limit?.secondary_window?.limit_window_seconds ?? 604800,
  );

  return {
    planType: data.plan_type ?? "unknown",
    email: data.email,
    limitReached: data.rate_limit?.limit_reached ?? false,
    primary: windowSnapshot(data.rate_limit?.primary_window, primaryLabel),
    secondary: data.rate_limit?.secondary_window
      ? windowSnapshot(data.rate_limit.secondary_window, secondaryLabel)
      : undefined,
    credits: data.credits
      ? {
          balance: data.credits.balance,
          unlimited: data.credits.unlimited,
          hasCredits: data.credits.has_credits,
        }
      : undefined,
    spendControlReached: data.spend_control?.reached,
  };
}

export function formatUsageOutput(
  snapshot: UsageSnapshot,
  sourcePath: string,
  options: DisplayOptions = {},
  authToken?: string,
): string {
  const lines: string[] = [];

  const account = snapshot.email
    ? `${snapshot.email} (${snapshot.planType})`
    : snapshot.planType;

  lines.push(`Codex usage — ${account}`);
  lines.push(...formatAuthLines(sourcePath, authToken, options));
  lines.push("");

  if (snapshot.primary) {
    lines.push(formatWindowLine(snapshot.primary));
  }
  if (snapshot.secondary) {
    lines.push(formatWindowLine(snapshot.secondary));
  }

  if (snapshot.credits?.hasCredits || snapshot.credits?.balance) {
    lines.push("");
    if (snapshot.credits.unlimited) {
      lines.push("Credits: unlimited");
    } else if (snapshot.credits.balance != null) {
      lines.push(`Credits balance: ${snapshot.credits.balance}`);
    }
  }

  if (snapshot.limitReached) {
    lines.push("");
    lines.push("⚠️  Rate limit reached");
  }
  if (snapshot.spendControlReached) {
    lines.push("⚠️  Spend control limit reached");
  }

  return lines.join("\n");
}

function formatWindowLine(w: WindowSnapshot): string {
  const bar = progressBar(w.usedPercent);
  const used = w.usedPercent.toFixed(1);
  const remain = w.remainingPercent.toFixed(1);
  let line = `${w.label.padEnd(8)} ${bar} ${used}% used (${remain}% left)`;
  if (w.resetAfterSeconds != null) {
    line += ` · resets in ${formatDuration(w.resetAfterSeconds)}`;
  } else if (w.resetAt) {
    line += ` · resets at ${w.resetAt.toLocaleString()}`;
  }
  return line;
}
