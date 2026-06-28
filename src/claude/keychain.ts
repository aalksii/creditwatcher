import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Keychain service names used by Claude Code (legacy and hashed config dir). */
export function claudeKeychainServiceNames(): string[] {
  const configDir = expandHome(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  );
  const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 16);
  return [
    `Claude Code-credentials-${hash}`,
    "Claude Code-credentials",
  ];
}

async function readKeychainService(service: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const username = userInfo().username;
  if (!username) return null;

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      username,
      "-w",
    ]);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Read Claude Code credentials JSON from macOS Keychain when present. */
export async function readClaudeKeychainCredentials(): Promise<{
  raw: string;
  service: string;
} | null> {
  for (const service of claudeKeychainServiceNames()) {
    const raw = await readKeychainService(service);
    if (raw) {
      return { raw, service };
    }
  }
  return null;
}
