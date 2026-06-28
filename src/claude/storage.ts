import { readFile, mkdir, writeFile, chmod, rename } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { readClaudeKeychainCredentials } from "./keychain.js";

const CREDITWATCHER_DIR = join(homedir(), ".creditwatcher");
const CREDITWATCHER_CLAUDE_AUTH = join(CREDITWATCHER_DIR, "claude-auth.json");

export interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date;
  subscriptionType?: string;
  sourcePath: string;
  /** True when loaded from Claude Code's own store (do not write back). */
  managedByClaudeCode: boolean;
}

export function claudeCredentialsPath(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(configDir, ".credentials.json");
}

export function creditwatcherClaudeAuthPath(): string {
  return CREDITWATCHER_CLAUDE_AUTH;
}

function parseExpiresAt(value?: number): Date | undefined {
  if (value == null) return undefined;
  if (value > 1e12) return new Date(value);
  return new Date(value * 1000);
}

function parseCredentialsJson(
  raw: string,
  sourcePath: string,
  managedByClaudeCode: boolean,
): ClaudeCredentials | null {
  let file: ClaudeCredentialsFile;
  try {
    file = JSON.parse(raw) as ClaudeCredentialsFile;
  } catch {
    throw new Error(`Invalid Claude credentials at ${sourcePath}`);
  }

  const oauth = file.claudeAiOauth;
  if (!oauth?.accessToken) {
    return null;
  }

  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken ?? "",
    expiresAt: parseExpiresAt(oauth.expiresAt),
    subscriptionType: oauth.subscriptionType,
    sourcePath,
    managedByClaudeCode,
  };
}

async function tryLoadFile(path: string, managedByClaudeCode: boolean) {
  try {
    const raw = await readFile(path, "utf8");
    return parseCredentialsJson(raw, path, managedByClaudeCode);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function loadClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const keychainRaw = await readClaudeKeychainCredentials();
  if (keychainRaw) {
    const fromKeychain = parseCredentialsJson(
      keychainRaw,
      `macOS Keychain (Claude Code-credentials, ${userInfo().username})`,
      true,
    );
    if (fromKeychain) return fromKeychain;
  }

  const claudePath = claudeCredentialsPath();
  const fromClaude = await tryLoadFile(claudePath, true);
  if (fromClaude) return fromClaude;

  return tryLoadFile(creditwatcherClaudeAuthPath(), false);
}

export async function importClaudeCredentials(): Promise<ClaudeCredentials> {
  const existing = await loadClaudeCredentials();
  if (!existing) {
    throw new Error(
      "No Claude Code credentials found. Run `claude` and sign in first, then retry.",
    );
  }

  const dest = creditwatcherClaudeAuthPath();
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const oauth = {
    accessToken: existing.accessToken,
    refreshToken: existing.refreshToken,
    expiresAt: existing.expiresAt?.getTime(),
    subscriptionType: existing.subscriptionType,
  };

  const body = JSON.stringify({ claudeAiOauth: oauth }, null, 2);
  const tmp = join(dir, `.claude-auth.${process.pid}.tmp`);
  await writeFile(tmp, body, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, dest);
  await chmod(dest, 0o600);

  return {
    ...existing,
    sourcePath: dest,
    managedByClaudeCode: false,
  };
}
