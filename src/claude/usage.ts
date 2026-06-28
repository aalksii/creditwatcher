import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { USAGE_MIN_INTERVAL_SEC } from "../constants.js";
import { clampPercent, formatDuration, progressBar } from "../utils.js";
import {
  CLAUDE_OAUTH_BETA,
  CLAUDE_USAGE_URL,
  CLAUDE_USER_AGENT,
} from "./constants.js";
import type { ClaudeCredentials } from "./storage.js";
import { loadClaudeCredentials } from "./storage.js";

const CACHE_FILE = join(homedir(), ".creditwatcher", "usage-cache-claude.json");

interface UsageCache {
  fetchedAt: number;
}

export interface ClaudeQuotaWindow {
  key: string;
  label: string;
  utilization: number;
  resetsAt?: Date;
}

export interface ClaudeUsageSnapshot {
  subscriptionType?: string;
  windows: ClaudeQuotaWindow[];
}

interface ClaudeQuotaEntry {
  utilization?: number | null;
  resets_at?: string | null;
  is_enabled?: boolean | null;
}

type ClaudeUsageResponse = Record<string, ClaudeQuotaEntry | undefined>;

const DISPLAY_ORDER = [
  "five_hour",
  "seven_day",
  "seven_day_sonnet",
  "seven_day_opus",
] as const;

const LABELS: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "7-day",
  seven_day_sonnet: "7-day Sonnet",
  seven_day_opus: "7-day Opus",
};

async function readCache(): Promise<UsageCache | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as UsageCache;
  } catch {
    return null;
  }
}

async function writeCache(): Promise<void> {
  await mkdir(join(homedir(), ".creditwatcher"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ fetchedAt: Date.now() }),
    { mode: 0o600 },
  );
}

function parseResetsAt(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function snapshotFromResponse(
  data: ClaudeUsageResponse,
  subscriptionType?: string,
): ClaudeUsageSnapshot {
  const windows: ClaudeQuotaWindow[] = [];

  const keys = [
    ...DISPLAY_ORDER.filter((k) => data[k]),
    ...Object.keys(data).filter(
      (k) => !DISPLAY_ORDER.includes(k as (typeof DISPLAY_ORDER)[number]),
    ),
  ];

  for (const key of keys) {
    if (!DISPLAY_ORDER.includes(key as (typeof DISPLAY_ORDER)[number])) {
      continue;
    }

    const entry = data[key];
    if (!entry || entry.utilization == null) continue;
    if (entry.is_enabled === false) continue;

    windows.push({
      key,
      label: LABELS[key] ?? key,
      utilization: clampPercent(entry.utilization),
      resetsAt: parseResetsAt(entry.resets_at),
    });
  }

  return { subscriptionType, windows };
}

export async function fetchClaudeUsage(options: {
  force?: boolean;
} = {}): Promise<{ snapshot: ClaudeUsageSnapshot; sourcePath: string }> {
  if (!options.force) {
    const cache = await readCache();
    if (cache) {
      const elapsed = (Date.now() - cache.fetchedAt) / 1000;
      if (elapsed < USAGE_MIN_INTERVAL_SEC) {
        const wait = Math.ceil(USAGE_MIN_INTERVAL_SEC - elapsed);
        throw new Error(
          `Claude usage was checked recently. Wait ${wait}s before checking again (max once per ${USAGE_MIN_INTERVAL_SEC}s).`,
        );
      }
    }
  }

  const creds = await loadClaudeCredentials();
  if (!creds) {
    throw new Error("Not logged in to Claude Code");
  }

  if (
    !creds.managedByClaudeCode &&
    creds.expiresAt &&
    creds.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error(
      "Claude OAuth token expired. Run `claude` to sign in again, then `creditwatcher login claude`.",
    );
  }

  const res = await fetch(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: "application/json",
      "anthropic-beta": CLAUDE_OAUTH_BETA,
      "User-Agent": CLAUDE_USER_AGENT,
    },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Claude usage request failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  let data: ClaudeUsageResponse;
  try {
    data = JSON.parse(body) as ClaudeUsageResponse;
  } catch {
    throw new Error("Claude usage endpoint returned invalid JSON");
  }

  await writeCache();
  return {
    snapshot: snapshotFromResponse(data, creds.subscriptionType),
    sourcePath: creds.sourcePath,
  };
}

export function formatClaudeUsageOutput(
  snapshot: ClaudeUsageSnapshot,
  sourcePath: string,
): string {
  const lines: string[] = [];
  const plan = snapshot.subscriptionType ?? "Claude";
  lines.push(`Claude usage — ${plan}`);
  lines.push(`Auth: ${sourcePath}`);
  lines.push("");

  if (snapshot.windows.length === 0) {
    lines.push("No usage windows returned.");
    return lines.join("\n");
  }

  for (const w of snapshot.windows) {
    const used = w.utilization.toFixed(1);
    const remain = clampPercent(100 - w.utilization).toFixed(1);
    const bar = progressBar(w.utilization);
    let line = `${w.label.padEnd(14)} ${bar} ${used}% used (${remain}% left)`;
    if (w.resetsAt) {
      const seconds = Math.max(
        0,
        Math.floor((w.resetsAt.getTime() - Date.now()) / 1000),
      );
      line += ` · resets in ${formatDuration(seconds)}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}
