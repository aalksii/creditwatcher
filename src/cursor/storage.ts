import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile, chmod, rename } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseJwtPayload } from "../utils.js";

const execFileAsync = promisify(execFile);

const CREDITWATCHER_DIR = join(homedir(), ".creditwatcher");
const CREDITWATCHER_CURSOR_AUTH = join(CREDITWATCHER_DIR, "cursor-auth.json");

const SQLITE_ACCESS_TOKEN_KEY = "cursorAuth/accessToken";

export interface CursorAuthFile {
  sessionToken?: string;
  source?: string;
}

export interface CursorCredentials {
  /** Value for WorkosCursorSessionToken cookie (sub::jwt or raw token). */
  sessionToken: string;
  sourcePath: string;
}

export function cursorStateDbPath(): string {
  const override = process.env.CURSOR_STATE_DB?.trim();
  if (override) return override;

  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      );
    case "win32":
      return join(
        process.env.APPDATA ?? join(home, "AppData", "Roaming"),
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      );
    default:
      return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
  }
}

export function creditwatcherCursorAuthPath(): string {
  return CREDITWATCHER_CURSOR_AUTH;
}

function normalizeSessionToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes("::") || trimmed.includes("%3A%3A")) {
    return trimmed.replace(/%3A%3A/gi, "::");
  }

  const jwt = trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
  const payload = parseJwtPayload(jwt);
  if (!payload) return trimmed;

  const sub =
    typeof payload.sub === "string"
      ? payload.sub
      : typeof payload.user_id === "string"
        ? payload.user_id
        : null;

  if (!sub) return trimmed;
  return `${sub}::${jwt}`;
}

async function readSqliteValue(dbPath: string, key: string): Promise<string | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get(key) as { value?: string | Buffer } | undefined;
      if (!row?.value) return null;
      return typeof row.value === "string" ? row.value : row.value.toString("utf8");
    } finally {
      db.close();
    }
  } catch {
    // node:sqlite unavailable — fall back to sqlite3 CLI
  }

  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-readonly", dbPath, `SELECT value FROM ItemTable WHERE key='${key.replace(/'/g, "''")}';`],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function loadFromCursorApp(): Promise<CursorCredentials | null> {
  const dbPath = cursorStateDbPath();
  const accessToken = await readSqliteValue(dbPath, SQLITE_ACCESS_TOKEN_KEY);
  if (!accessToken) return null;

  const sessionToken = normalizeSessionToken(accessToken);
  if (!sessionToken) return null;

  return {
    sessionToken,
    sourcePath: dbPath,
  };
}

async function loadFromSavedCopy(): Promise<CursorCredentials | null> {
  try {
    const raw = await readFile(creditwatcherCursorAuthPath(), "utf8");
    const file = JSON.parse(raw) as CursorAuthFile;
    const sessionToken = file.sessionToken
      ? normalizeSessionToken(file.sessionToken)
      : null;
    if (!sessionToken) return null;
    return {
      sessionToken,
      sourcePath: creditwatcherCursorAuthPath(),
    };
  } catch {
    return null;
  }
}

function loadFromEnv(): CursorCredentials | null {
  const raw = process.env.CURSOR_SESSION_TOKEN?.trim();
  if (!raw) return null;
  const sessionToken = normalizeSessionToken(raw);
  if (!sessionToken) return null;
  return {
    sessionToken,
    sourcePath: "CURSOR_SESSION_TOKEN environment variable",
  };
}

export async function loadCursorCredentialCandidates(): Promise<
  CursorCredentials[]
> {
  const candidates: CursorCredentials[] = [];

  const fromEnv = loadFromEnv();
  if (fromEnv) candidates.push(fromEnv);

  const fromApp = await loadFromCursorApp();
  if (fromApp) candidates.push(fromApp);

  const fromCopy = await loadFromSavedCopy();
  if (fromCopy) candidates.push(fromCopy);

  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.sessionToken)) return false;
    seen.add(c.sessionToken);
    return true;
  });
}

export async function loadCursorCredentials(): Promise<CursorCredentials | null> {
  const candidates = await loadCursorCredentialCandidates();
  return candidates[0] ?? null;
}

export async function saveCursorCredentialsCopy(
  creds: CursorCredentials,
): Promise<CursorCredentials> {
  const dest = creditwatcherCursorAuthPath();
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const body = JSON.stringify(
    {
      sessionToken: creds.sessionToken,
      source: creds.sourcePath,
    },
    null,
    2,
  );
  const tmp = join(dir, `.cursor-auth.${process.pid}.tmp`);
  await writeFile(tmp, body, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, dest);
  await chmod(dest, 0o600);

  return {
    ...creds,
    sourcePath: dest,
  };
}

export async function importCursorCredentials(): Promise<CursorCredentials> {
  const existing = await loadCursorCredentials();
  if (!existing) {
    throw new Error(
      "No Cursor session found. Sign in to the Cursor app, or set CURSOR_SESSION_TOKEN.",
    );
  }

  if (existing.sourcePath === creditwatcherCursorAuthPath()) {
    return existing;
  }

  return saveCursorCredentialsCopy(existing);
}
