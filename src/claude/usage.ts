import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { USAGE_MIN_INTERVAL_SEC } from "../constants.js";
import type { DisplayOptions } from "../display-options.js";
import { formatAuthLines } from "../display-options.js";
import { clampPercent, formatDuration, progressBar } from "../utils.js";
import {
  CLAUDE_OAUTH_BETA,
  CLAUDE_USAGE_URL,
  CLAUDE_USER_AGENT,
} from "./constants.js";
import {
  ClaudeAuthError,
  ensureFreshClaudeCredentials,
  refreshClaudeAccessToken,
} from "./refresh.js";
import type { ClaudeCredentials } from "./storage.js";
import {
  claudeCredentialsMissingProfileScope,
  loadClaudeCredentialCandidates,
} from "./storage.js";

const CACHE_FILE = join(homedir(), ".creditwatcher", "usage-cache-claude.json");

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

async function readCache(): Promise<{ fetchedAt: number } | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as { fetchedAt: number };
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

async function requestClaudeUsage(
  accessToken: string,
): Promise<ClaudeUsageResponse> {
  const res = await fetch(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": CLAUDE_OAUTH_BETA,
      "User-Agent": CLAUDE_USER_AGENT,
    },
  });

  const body = await res.text();
  if (!res.ok) {
    const err = new Error(
      `Claude usage request failed (${res.status}): ${body.slice(0, 200)}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  try {
    return JSON.parse(body) as ClaudeUsageResponse;
  } catch {
    throw new Error("Claude usage endpoint returned invalid JSON");
  }
}

function isAuthFailure(err: unknown): boolean {
  if (err instanceof ClaudeAuthError) return true;
  const status = (err as { status?: number }).status;
  return status === 401 || status === 403;
}

async function fetchUsageWithCredential(
  creds: ClaudeCredentials,
): Promise<{ snapshot: ClaudeUsageSnapshot; sourcePath: string }> {
  if (claudeCredentialsMissingProfileScope(creds)) {
    throw new Error(
      "Claude OAuth token lacks user:profile scope required for /api/oauth/usage. Run `claude` to sign in again.",
    );
  }

  let active = await ensureFreshClaudeCredentials(creds);

  try {
    const data = await requestClaudeUsage(active.accessToken);
    return {
      snapshot: snapshotFromResponse(data, active.subscriptionType),
      sourcePath: active.sourcePath,
    };
  } catch (err) {
    if (!isAuthFailure(err) || !active.refreshToken) {
      throw err;
    }
  }

  const refreshed = await refreshClaudeAccessToken(active.refreshToken);
  active = {
    ...active,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt ?? active.expiresAt,
    managedByClaudeCode: false,
  };

  const { saveClaudeCredentialsCopy } = await import("./storage.js");
  active = await saveClaudeCredentialsCopy(active);

  const data = await requestClaudeUsage(active.accessToken);
  return {
    snapshot: snapshotFromResponse(data, active.subscriptionType),
    sourcePath: active.sourcePath,
  };
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

  const candidates = await loadClaudeCredentialCandidates();
  if (candidates.length === 0) {
    throw new Error("Not logged in to Claude Code");
  }

  let lastAuthError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const result = await fetchUsageWithCredential(candidate);
      await writeCache();
      return result;
    } catch (err) {
      if (
        err instanceof ClaudeAuthError &&
        err.allowsSourceFallback
      ) {
        lastAuthError = err;
        continue;
      }

      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        lastAuthError =
          err instanceof Error
            ? err
            : new Error("Claude authentication failed");
        continue;
      }

      throw err;
    }
  }

  throw (
    lastAuthError ??
    new Error(
      "Claude authentication failed for all credential sources. Run `claude` to sign in again.",
    )
  );
}

export function formatClaudeUsageOutput(
  snapshot: ClaudeUsageSnapshot,
  sourcePath: string,
  options: DisplayOptions = {},
  authToken?: string,
): string {
  const lines: string[] = [];
  const plan = snapshot.subscriptionType ?? "Claude";
  lines.push(`Claude usage — ${plan}`);
  lines.push(...formatAuthLines(sourcePath, authToken, options));
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
