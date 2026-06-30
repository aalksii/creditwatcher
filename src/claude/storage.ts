import { readFile, mkdir, writeFile, chmod, rename } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { jwtExpiration } from "../utils.js";
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
  scopes?: string[];
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

function credentialExpiryMs(creds: ClaudeCredentials): number {
  const jwtExp = jwtExpiration(creds.accessToken);
  if (jwtExp) return jwtExp.getTime();
  if (creds.expiresAt) return creds.expiresAt.getTime();
  return 0;
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
    scopes: oauth.scopes,
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

function sortCandidates(candidates: ClaudeCredentials[]): ClaudeCredentials[] {
  return [...candidates].sort((a, b) => {
    const diff = credentialExpiryMs(b) - credentialExpiryMs(a);
    if (diff !== 0) return diff;
    if (a.managedByClaudeCode !== b.managedByClaudeCode) {
      return a.managedByClaudeCode ? -1 : 1;
    }
    return a.sourcePath.localeCompare(b.sourcePath);
  });
}

export async function loadClaudeCredentialCandidates(options?: {
  includeKeychain?: boolean;
}): Promise<ClaudeCredentials[]> {
  const candidates: ClaudeCredentials[] = [];

  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) {
    const fromEnv = parseCredentialsJson(
      JSON.stringify({ claudeAiOauth: { accessToken: envToken } }),
      "CLAUDE_CODE_OAUTH_TOKEN environment variable",
      true,
    );
    if (fromEnv) candidates.push(fromEnv);
  }

  const claudePath = claudeCredentialsPath();
  const fromClaude = await tryLoadFile(claudePath, true);
  if (fromClaude) {
    candidates.push(fromClaude);
  } else if (options?.includeKeychain) {
    const keychain = await readClaudeKeychainCredentials();
    if (keychain) {
      const fromKeychain = parseCredentialsJson(
        keychain.raw,
        `macOS Keychain (${keychain.service}, ${userInfo().username})`,
        true,
      );
      if (fromKeychain) candidates.push(fromKeychain);
    }
  }

  const fromCopy = await tryLoadFile(creditwatcherClaudeAuthPath(), false);
  if (fromCopy) candidates.push(fromCopy);

  return sortCandidates(candidates);
}

export async function loadClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const candidates = await loadClaudeCredentialCandidates();
  return candidates[0] ?? null;
}

export async function saveClaudeCredentialsCopy(
  creds: ClaudeCredentials,
): Promise<ClaudeCredentials> {
  const dest = creditwatcherClaudeAuthPath();
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const oauth = {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt?.getTime(),
    subscriptionType: creds.subscriptionType,
    scopes: creds.scopes,
  };

  const body = JSON.stringify({ claudeAiOauth: oauth }, null, 2);
  const tmp = join(dir, `.claude-auth.${process.pid}.tmp`);
  await writeFile(tmp, body, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, dest);
  await chmod(dest, 0o600);

  return {
    ...creds,
    sourcePath: dest,
    managedByClaudeCode: false,
  };
}

export async function importClaudeCredentials(): Promise<ClaudeCredentials> {
  const existing = (
    await loadClaudeCredentialCandidates({ includeKeychain: true })
  )[0];
  if (!existing) {
    throw new Error(
      "No Claude Code credentials found. Run `claude` and sign in first, then retry.",
    );
  }

  return saveClaudeCredentialsCopy(existing);
}

export function claudeCredentialsMissingProfileScope(
  creds: ClaudeCredentials,
): boolean {
  if (!creds.scopes?.length) return false;
  return !creds.scopes.includes("user:profile");
}
