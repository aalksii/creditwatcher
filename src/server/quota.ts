import { ensureFreshCredentials } from "../auth/refresh.js";
import { loadCredentials } from "../auth/storage.js";
import { fetchClaudeUsage } from "../claude/usage.js";
import { loadClaudeCredentials } from "../claude/storage.js";
import { fetchUsage } from "../codex/usage.js";
import type { UsageSnapshot, WindowSnapshot } from "../types.js";
import type { ClaudeUsageSnapshot } from "../claude/usage.js";
import { loadQuotaCache, saveQuotaCache } from "./quota-cache.js";

export interface QuotaWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: string;
  resetAfterSeconds?: number;
}

export interface ProviderQuota {
  status: "ok" | "not_connected" | "error" | "cooldown";
  provider: "codex" | "claude";
  plan?: string;
  account?: string;
  authSource?: string;
  windows: QuotaWindow[];
  credits?: {
    balance?: string;
    unlimited?: boolean;
    hasCredits?: boolean;
  };
  warnings: string[];
  error?: string;
  loginHint?: string;
  lastUpdated?: string;
  cooldownSeconds?: number;
  cached?: boolean;
  nextRefreshAt?: string;
  secondsUntilRefresh?: number;
}

export interface QuotaResponse {
  codex: ProviderQuota;
  claude: ProviderQuota;
  fetchedAt: string;
}

interface CachedProvider {
  data: ProviderQuota;
  fetchedAt: number;
}

const cache: Partial<Record<"codex" | "claude", CachedProvider>> = {};

export function parseCooldownSeconds(message: string): number | undefined {
  const match = message.match(/Wait (\d+)s before/);
  return match ? Number(match[1]) : undefined;
}

function classifyHttpError(message: string): string {
  if (message.includes("(401)") || message.includes("(403)")) {
    return "Authentication failed. Re-login with the official CLI.";
  }
  if (message.includes("(429)")) {
    return "Rate limited. Try again later.";
  }
  return message;
}

function serializeWindow(w: WindowSnapshot): QuotaWindow {
  const resetAfterSeconds =
    w.resetAfterSeconds ??
    (w.resetAt
      ? Math.max(0, Math.floor((w.resetAt.getTime() - Date.now()) / 1000))
      : undefined);

  return {
    label: w.label,
    usedPercent: w.usedPercent,
    remainingPercent: w.remainingPercent,
    resetAt: w.resetAt?.toISOString(),
    resetAfterSeconds,
  };
}

function codexFromSnapshot(
  snapshot: UsageSnapshot,
  sourcePath: string,
): Omit<ProviderQuota, "status" | "provider"> {
  const windows: QuotaWindow[] = [];
  if (snapshot.primary) windows.push(serializeWindow(snapshot.primary));
  if (snapshot.secondary) windows.push(serializeWindow(snapshot.secondary));

  const warnings: string[] = [];
  if (snapshot.limitReached) warnings.push("Rate limit reached");
  if (snapshot.spendControlReached) warnings.push("Spend control limit reached");

  return {
    plan: snapshot.planType,
    account: snapshot.email,
    authSource: sourcePath,
    windows,
    credits: snapshot.credits,
    warnings,
    lastUpdated: new Date().toISOString(),
  };
}

function claudeFromSnapshot(
  snapshot: ClaudeUsageSnapshot,
  sourcePath: string,
): Omit<ProviderQuota, "status" | "provider"> {
  return {
    plan: snapshot.subscriptionType,
    authSource: sourcePath,
    windows: snapshot.windows.map((w) => ({
      label: w.label,
      usedPercent: w.utilization,
      remainingPercent: 100 - w.utilization,
      resetAt: w.resetsAt?.toISOString(),
      resetAfterSeconds: w.resetsAt
        ? Math.max(0, Math.floor((w.resetsAt.getTime() - Date.now()) / 1000))
        : undefined,
    })),
    warnings: [],
    lastUpdated: new Date().toISOString(),
  };
}

function notConnected(
  provider: "codex" | "claude",
): ProviderQuota {
  const loginHint =
    provider === "codex"
      ? "Run `codex login` or `creditwatcher login codex`"
      : "Run `claude` to sign in, or `creditwatcher login claude`";

  return {
    status: "not_connected",
    provider,
    windows: [],
    warnings: [],
    loginHint,
  };
}

async function ensureMemoryCache(provider: "codex" | "claude"): Promise<void> {
  if (cache[provider]) return;
  const entry = await loadQuotaCache(provider);
  if (entry) {
    cache[provider] = { data: entry.data, fetchedAt: entry.fetchedAt };
  }
}

async function resolveCachedData(
  provider: "codex" | "claude",
): Promise<ProviderQuota | undefined> {
  await ensureMemoryCache(provider);
  return cache[provider]?.data;
}

async function withCache(
  provider: "codex" | "claude",
  data: ProviderQuota,
): Promise<ProviderQuota> {
  cache[provider] = { data, fetchedAt: Date.now() };
  await saveQuotaCache(provider, data);
  return data;
}

function cooldownQuota(
  provider: "codex" | "claude",
  cached: ProviderQuota,
  cooldownSeconds: number,
): ProviderQuota {
  const nextRefreshAt = new Date(
    Date.now() + cooldownSeconds * 1000,
  ).toISOString();

  return {
    ...cached,
    provider,
    status: "cooldown",
    cached: true,
    cooldownSeconds,
    secondsUntilRefresh: cooldownSeconds,
    nextRefreshAt,
  };
}

async function cachedOrError(
  provider: "codex" | "claude",
  err: unknown,
): Promise<ProviderQuota> {
  const message = err instanceof Error ? err.message : String(err);
  const cooldownSeconds = parseCooldownSeconds(message);
  const cached = await resolveCachedData(provider);

  if (cooldownSeconds != null && cached) {
    return cooldownQuota(provider, cached, cooldownSeconds);
  }

  if (cooldownSeconds != null) {
    const nextRefreshAt = new Date(
      Date.now() + cooldownSeconds * 1000,
    ).toISOString();

    return {
      status: "cooldown",
      provider,
      windows: [],
      warnings: [],
      cooldownSeconds,
      secondsUntilRefresh: cooldownSeconds,
      nextRefreshAt,
      error: `Usage was checked recently. Wait ${cooldownSeconds}s before checking again.`,
    };
  }

  return {
    status: "error",
    provider,
    windows: cached?.windows ?? [],
    warnings: cached?.warnings ?? [],
    plan: cached?.plan,
    account: cached?.account,
    authSource: cached?.authSource,
    credits: cached?.credits,
    lastUpdated: cached?.lastUpdated,
    cached: cached != null,
    error: classifyHttpError(message),
  };
}

async function fetchCodexQuota(force: boolean): Promise<ProviderQuota> {
  await ensureMemoryCache("codex");
  const creds = await loadCredentials();
  if (!creds) return notConnected("codex");

  try {
    const fresh = await ensureFreshCredentials(creds);
    const snapshot = await fetchUsage(fresh, { force });
    return await withCache("codex", {
      status: "ok",
      provider: "codex",
      ...codexFromSnapshot(snapshot, fresh.sourcePath),
    });
  } catch (err) {
    return cachedOrError("codex", err);
  }
}

async function fetchClaudeQuota(force: boolean): Promise<ProviderQuota> {
  await ensureMemoryCache("claude");
  const creds = await loadClaudeCredentials();
  if (!creds) return notConnected("claude");

  try {
    const { snapshot, sourcePath } = await fetchClaudeUsage({ force });
    return await withCache("claude", {
      status: "ok",
      provider: "claude",
      ...claudeFromSnapshot(snapshot, sourcePath),
    });
  } catch (err) {
    return cachedOrError("claude", err);
  }
}

export async function getQuota(options: {
  force?: boolean;
} = {}): Promise<QuotaResponse> {
  const [codex, claude] = await Promise.all([
    fetchCodexQuota(options.force ?? false),
    fetchClaudeQuota(options.force ?? false),
  ]);

  return {
    codex,
    claude,
    fetchedAt: new Date().toISOString(),
  };
}
