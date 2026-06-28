import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthFile, Credentials } from "../types.js";
import { jwtChatGptAccountId } from "../utils.js";

const CREDITWATCHER_DIR = join(homedir(), ".creditwatcher");
const CREDITWATCHER_AUTH = join(CREDITWATCHER_DIR, "auth.json");

export function creditwatcherAuthPath(): string {
  return CREDITWATCHER_AUTH;
}

export function codexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(codexHome, "auth.json");
}

export async function loadCredentials(): Promise<Credentials | null> {
  // Prefer ~/.codex/auth.json (official CLI) — safest path when available.
  const paths = [codexAuthPath(), creditwatcherAuthPath()];
  for (const path of paths) {
    const creds = await tryLoadAuthFile(path);
    if (creds) return creds;
  }
  return null;
}

async function tryLoadAuthFile(path: string): Promise<Credentials | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let file: AuthFile;
  try {
    file = JSON.parse(raw) as AuthFile;
  } catch {
    throw new Error(`Invalid auth file at ${path}`);
  }

  if (!file.tokens?.access_token || !file.tokens.refresh_token) {
    return null;
  }

  const accountId =
    file.tokens.account_id ??
    jwtChatGptAccountId(file.tokens.id_token ?? "") ??
    "";

  return {
    idToken: file.tokens.id_token ?? "",
    accessToken: file.tokens.access_token,
    refreshToken: file.tokens.refresh_token,
    accountId,
    lastRefresh: file.last_refresh ? new Date(file.last_refresh) : undefined,
    sourcePath: path,
  };
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const path = creditwatcherAuthPath();
  const dir = dirname(path);

  const authFile: AuthFile = {
    tokens: {
      id_token: creds.idToken,
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      account_id: creds.accountId || undefined,
    },
    last_refresh: (creds.lastRefresh ?? new Date()).toISOString(),
  };

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.auth.json.${process.pid}.tmp`);
  const body = JSON.stringify(authFile, null, 2);
  await writeFile(tmp, body, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}
