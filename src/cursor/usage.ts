import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { USAGE_MIN_INTERVAL_SEC } from "../constants.js";
import type { DisplayOptions } from "../display-options.js";
import { formatAuthLines } from "../display-options.js";
import {
  clampPercent,
  formatDuration,
  progressBar,
  usageCooldownWaitSeconds,
  usageFetchedAtNow,
} from "../utils.js";
import {
  CURSOR_AUTH_ME_URL,
  CURSOR_SESSION_COOKIE,
  CURSOR_USAGE_SUMMARY_URL,
} from "./constants.js";
import type { CursorCredentials } from "./storage.js";
import { loadCursorCredentialCandidates } from "./storage.js";

const CACHE_FILE = join(homedir(), ".creditwatcher", "usage-cache-cursor.json");

export interface CursorQuotaWindow {
  label: string;
  usedPercent: number;
  detail?: string;
  resetsAt?: Date;
}

export interface CursorUsageSnapshot {
  membershipType: string;
  email?: string;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  isUnlimited?: boolean;
  windows: CursorQuotaWindow[];
  onDemandUsedCents?: number;
  onDemandLimitCents?: number | null;
  warnings: string[];
}

interface CursorUsagePlan {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
}

interface CursorUsageSummaryResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  isUnlimited?: boolean;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
  individualUsage?: {
    plan?: CursorUsagePlan;
    onDemand?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
    };
  };
}

interface CursorAuthMeResponse {
  email?: string;
  name?: string;
  workosId?: string;
}

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
    JSON.stringify({ fetchedAt: usageFetchedAtNow() }),
    { mode: 0o600 },
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPlanName(membershipType?: string): string {
  if (!membershipType) return "unknown";
  return membershipType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function snapshotFromSummary(
  summary: CursorUsageSummaryResponse,
  identity?: CursorAuthMeResponse,
): CursorUsageSnapshot {
  const plan = summary.individualUsage?.plan;
  const onDemand = summary.individualUsage?.onDemand;
  const windows: CursorQuotaWindow[] = [];
  const warnings: string[] = [];

  const cycleEnd = summary.billingCycleEnd
    ? new Date(summary.billingCycleEnd)
    : undefined;

  if (plan?.enabled !== false) {
    const usedPercent =
      plan?.totalPercentUsed ??
      (plan?.limit
        ? clampPercent(((plan.used ?? 0) / plan.limit) * 100)
        : 0);

    let detail: string | undefined;
    if (plan?.used != null && plan.limit != null) {
      detail = `${plan.used}/${plan.limit}`;
    }

    windows.push({
      label: "included",
      usedPercent: clampPercent(usedPercent),
      detail,
      resetsAt: cycleEnd,
    });

    if (
      plan?.apiPercentUsed != null &&
      Math.round(plan.apiPercentUsed) !== Math.round(usedPercent)
    ) {
      windows.push({
        label: "API",
        usedPercent: clampPercent(plan.apiPercentUsed),
        resetsAt: cycleEnd,
      });
    }

    if (
      plan?.autoPercentUsed != null &&
      plan.autoPercentUsed > 0 &&
      Math.round(plan.autoPercentUsed) !== Math.round(usedPercent)
    ) {
      windows.push({
        label: "auto",
        usedPercent: clampPercent(plan.autoPercentUsed),
        resetsAt: cycleEnd,
      });
    }
  }

  if (onDemand?.enabled) {
    const usedCents = onDemand.used ?? 0;
    let usedPercent = 0;
    if (onDemand.limit != null && onDemand.limit > 0) {
      usedPercent = clampPercent((usedCents / onDemand.limit) * 100);
    }

    windows.push({
      label: "on-demand",
      usedPercent,
      detail:
        onDemand.limit != null
          ? `${formatCents(usedCents)} / ${formatCents(onDemand.limit)}`
          : formatCents(usedCents),
      resetsAt: cycleEnd,
    });
  }

  if (summary.autoModelSelectedDisplayMessage?.includes("100%")) {
    warnings.push(summary.autoModelSelectedDisplayMessage);
  }
  if (summary.namedModelSelectedDisplayMessage?.includes("100%")) {
    warnings.push(summary.namedModelSelectedDisplayMessage);
  }

  return {
    membershipType: formatPlanName(summary.membershipType),
    email: identity?.email,
    billingCycleStart: summary.billingCycleStart,
    billingCycleEnd: summary.billingCycleEnd,
    isUnlimited: summary.isUnlimited,
    windows,
    onDemandUsedCents: onDemand?.enabled ? onDemand.used : undefined,
    onDemandLimitCents: onDemand?.enabled ? onDemand.limit : undefined,
    warnings,
  };
}

async function cursorGet<T>(
  url: string,
  sessionToken: string,
): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: `${CURSOR_SESSION_COOKIE}=${sessionToken}`,
    },
  });

  const body = await res.text();
  if (!res.ok) {
    const err = new Error(
      `Cursor request failed (${res.status}): ${body.slice(0, 200)}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Cursor endpoint returned invalid JSON");
  }
}

async function fetchUsageWithCredential(
  creds: CursorCredentials,
): Promise<{ snapshot: CursorUsageSnapshot; sourcePath: string }> {
  const [summary, identity] = await Promise.all([
    cursorGet<CursorUsageSummaryResponse>(
      CURSOR_USAGE_SUMMARY_URL,
      creds.sessionToken,
    ),
    cursorGet<CursorAuthMeResponse>(CURSOR_AUTH_ME_URL, creds.sessionToken).catch(
      () => undefined,
    ),
  ]);

  return {
    snapshot: snapshotFromSummary(summary, identity),
    sourcePath: creds.sourcePath,
  };
}

export async function fetchCursorUsage(options: {
  force?: boolean;
} = {}): Promise<{ snapshot: CursorUsageSnapshot; sourcePath: string }> {
  if (!options.force) {
    const cache = await readCache();
    if (cache) {
      const wait = usageCooldownWaitSeconds(
        cache.fetchedAt,
        USAGE_MIN_INTERVAL_SEC,
      );
      if (wait != null) {
        throw new Error(
          `Cursor usage was checked recently. Wait ${wait}s before checking again (max once per ${USAGE_MIN_INTERVAL_SEC}s).`,
        );
      }
    }
  }

  const candidates = await loadCursorCredentialCandidates();
  if (candidates.length === 0) {
    throw new Error("Not logged in to Cursor");
  }

  let lastAuthError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const result = await fetchUsageWithCredential(candidate);
      await writeCache();
      return result;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        lastAuthError =
          err instanceof Error
            ? err
            : new Error("Cursor authentication failed");
        continue;
      }
      throw err;
    }
  }

  throw (
    lastAuthError ??
    new Error(
      "Cursor authentication failed. Sign in to the Cursor app or run `creditwatcher login cursor`.",
    )
  );
}

export function formatCursorUsageOutput(
  snapshot: CursorUsageSnapshot,
  sourcePath: string,
  options: DisplayOptions = {},
  authToken?: string,
): string {
  const lines: string[] = [];
  const account = snapshot.email
    ? `${snapshot.email} (${snapshot.membershipType})`
    : snapshot.membershipType;

  lines.push(`Cursor usage — ${account}`);
  lines.push(...formatAuthLines(sourcePath, authToken, options));

  if (snapshot.billingCycleStart && snapshot.billingCycleEnd) {
    const start = new Date(snapshot.billingCycleStart).toLocaleDateString();
    const end = new Date(snapshot.billingCycleEnd).toLocaleDateString();
    lines.push(`Billing cycle: ${start} – ${end}`);
  }

  if (snapshot.isUnlimited) {
    lines.push("Plan: unlimited usage");
  }

  lines.push("");

  if (snapshot.windows.length === 0) {
    lines.push("No usage windows returned.");
  }

  for (const w of snapshot.windows) {
    const used = w.usedPercent.toFixed(1);
    const remain = clampPercent(100 - w.usedPercent).toFixed(1);
    const bar = progressBar(w.usedPercent);
    let line = `${w.label.padEnd(12)} ${bar} ${used}% used (${remain}% left)`;
    if (w.detail) line += ` · ${w.detail}`;
    if (w.resetsAt) {
      const seconds = Math.max(
        0,
        Math.floor((w.resetsAt.getTime() - Date.now()) / 1000),
      );
      if (seconds > 0) {
        line += ` · cycle ends in ${formatDuration(seconds)}`;
      }
    }
    lines.push(line);
  }

  for (const warning of snapshot.warnings) {
    lines.push(`⚠️  ${warning}`);
  }

  return lines.join("\n");
}
