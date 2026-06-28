import { loadCredentials } from "./auth/storage.js";
import { loadClaudeCredentials } from "./claude/storage.js";
import { loadCursorCredentials } from "./cursor/storage.js";
import type { QuotaProvider } from "./server/quota-cache.js";

export interface DisplayOptions {
  verbose?: boolean;
  showToken?: boolean;
}

export const TOKEN_WARNING =
  "Warning: printing auth tokens to the terminal. Clear your scrollback and avoid sharing this output.";

export function shouldShowAuth(options: DisplayOptions = {}): boolean {
  return options.verbose === true || options.showToken === true;
}

export function formatAuthLines(
  sourcePath: string | undefined,
  token: string | undefined,
  options: DisplayOptions = {},
): string[] {
  if (!shouldShowAuth(options)) return [];

  const lines: string[] = [];
  if (sourcePath) {
    lines.push(`Auth: ${sourcePath}`);
  }
  if (options.showToken && token) {
    lines.push(`Token: ${token}`);
  }
  return lines;
}

export async function loadProviderAuthToken(
  provider: QuotaProvider,
): Promise<string | undefined> {
  switch (provider) {
    case "codex": {
      const creds = await loadCredentials();
      return creds?.accessToken;
    }
    case "claude": {
      const creds = await loadClaudeCredentials();
      return creds?.accessToken;
    }
    case "cursor": {
      const creds = await loadCursorCredentials();
      return creds?.sessionToken;
    }
  }
}
