import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderQuota } from "./quota.js";

const CACHE_DIR = join(homedir(), ".creditwatcher");

const CACHE_FILES: Record<"codex" | "claude", string> = {
  codex: join(CACHE_DIR, "quota-cache-codex.json"),
  claude: join(CACHE_DIR, "quota-cache-claude.json"),
};

export interface QuotaCacheEntry {
  data: ProviderQuota;
  fetchedAt: number;
}

export async function loadQuotaCache(
  provider: "codex" | "claude",
): Promise<QuotaCacheEntry | null> {
  try {
    const raw = await readFile(CACHE_FILES[provider], "utf8");
    return JSON.parse(raw) as QuotaCacheEntry;
  } catch {
    return null;
  }
}

export async function saveQuotaCache(
  provider: "codex" | "claude",
  data: ProviderQuota,
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  const entry: QuotaCacheEntry = { data, fetchedAt: Date.now() };
  await writeFile(CACHE_FILES[provider], JSON.stringify(entry), {
    mode: 0o600,
  });
}
