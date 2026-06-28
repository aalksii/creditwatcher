import { DISCLAIMER } from "../constants.js";
import { ensureFreshCredentials } from "../auth/refresh.js";
import { loadCredentials } from "../auth/storage.js";
import { CLAUDE_DISCLAIMER } from "../claude/constants.js";
import { fetchClaudeUsage, formatClaudeUsageOutput } from "../claude/usage.js";
import { loadClaudeCredentials } from "../claude/storage.js";
import { CURSOR_DISCLAIMER } from "../cursor/constants.js";
import { fetchCursorUsage, formatCursorUsageOutput } from "../cursor/usage.js";
import { loadCursorCredentials } from "../cursor/storage.js";
import { fetchUsage, formatUsageOutput } from "../codex/usage.js";
import { formatProviderStatusBlock } from "../dashboard/terminal.js";
import type { DisplayOptions } from "../display-options.js";
import {
  loadProviderAuthToken,
  TOKEN_WARNING,
} from "../display-options.js";
import { getQuota, parseCooldownSeconds } from "../server/quota.js";
import type { QuotaProvider } from "../server/quota-cache.js";

export interface StatusCommandOptions extends DisplayOptions {
  force?: boolean;
}

function warnIfShowToken(options: StatusCommandOptions): void {
  if (options.showToken) {
    console.error(TOKEN_WARNING);
  }
}

async function printCachedStatus(
  provider: QuotaProvider,
  options: StatusCommandOptions,
): Promise<boolean> {
  const quota = await getQuota({ force: options.force });
  const data = quota[provider];
  if (data.cached) {
    const authToken = options.showToken
      ? await loadProviderAuthToken(provider)
      : undefined;
    console.log(formatProviderStatusBlock(data, options, authToken));
    return true;
  }
  return false;
}

export async function statusCodex(
  options: StatusCommandOptions = {},
): Promise<boolean> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error("Codex: not logged in.");
    console.error(
      "  Run `codex login` or `creditwatcher login codex`",
    );
    return false;
  }

  console.log(DISCLAIMER);
  console.log("");
  warnIfShowToken(options);

  try {
    const fresh = await ensureFreshCredentials(creds);
    const snapshot = await fetchUsage(fresh, { force: options.force });
    const authToken = options.showToken ? fresh.accessToken : undefined;
    console.log(
      formatUsageOutput(snapshot, fresh.sourcePath, options, authToken),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (parseCooldownSeconds(message) != null) {
      return (await printCachedStatus("codex", options)) || false;
    }
    console.error(`Codex: ${message}`);
    return false;
  }
}

export async function statusClaude(
  options: StatusCommandOptions = {},
): Promise<boolean> {
  const creds = await loadClaudeCredentials();
  if (!creds) {
    console.error("Claude: not logged in.");
    console.error(
      "  Run `claude` to sign in, or `creditwatcher login claude` to import credentials",
    );
    return false;
  }

  console.log(CLAUDE_DISCLAIMER);
  console.log("");
  warnIfShowToken(options);

  try {
    const { snapshot, sourcePath } = await fetchClaudeUsage({
      force: options.force,
    });
    const authToken = options.showToken ? creds.accessToken : undefined;
    console.log(
      formatClaudeUsageOutput(snapshot, sourcePath, options, authToken),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (parseCooldownSeconds(message) != null) {
      return (await printCachedStatus("claude", options)) || false;
    }
    console.error(`Claude: ${message}`);
    return false;
  }
}

export async function statusCursor(
  options: StatusCommandOptions = {},
): Promise<boolean> {
  const creds = await loadCursorCredentials();
  if (!creds) {
    console.error("Cursor: not logged in.");
    console.error(
      "  Sign in to the Cursor app, or run `creditwatcher login cursor`",
    );
    return false;
  }

  console.log(CURSOR_DISCLAIMER);
  console.log("");
  warnIfShowToken(options);

  try {
    const { snapshot, sourcePath } = await fetchCursorUsage({
      force: options.force,
    });
    const authToken = options.showToken ? creds.sessionToken : undefined;
    console.log(
      formatCursorUsageOutput(snapshot, sourcePath, options, authToken),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (parseCooldownSeconds(message) != null) {
      return (await printCachedStatus("cursor", options)) || false;
    }
    console.error(`Cursor: ${message}`);
    return false;
  }
}

export async function statusAll(
  options: StatusCommandOptions = {},
): Promise<void> {
  const codexCreds = await loadCredentials();
  const claudeCreds = await loadClaudeCredentials();
  const cursorCreds = await loadCursorCredentials();

  if (!codexCreds && !claudeCreds && !cursorCreds) {
    console.error("Not logged in to any provider.");
    console.error("");
    console.error("Codex: `codex login` or `creditwatcher login codex`");
    console.error(
      "Claude: `claude` sign-in or `creditwatcher login claude`",
    );
    console.error(
      "Cursor: sign in to Cursor app or `creditwatcher login cursor`",
    );
    process.exitCode = 1;
    return;
  }

  console.log(DISCLAIMER);
  console.log(CLAUDE_DISCLAIMER);
  if (cursorCreds) {
    console.log(CURSOR_DISCLAIMER);
  }
  console.log("");
  warnIfShowToken(options);

  let anyOk = false;
  let anyFail = false;

  const providers: Array<{
    name: QuotaProvider;
    hasCreds: boolean;
    run: () => Promise<void>;
  }> = [];

  if (codexCreds) {
    providers.push({
      name: "codex",
      hasCreds: true,
      run: async () => {
        const fresh = await ensureFreshCredentials(codexCreds);
        const snapshot = await fetchUsage(fresh, { force: options.force });
        const authToken = options.showToken ? fresh.accessToken : undefined;
        console.log(
          formatUsageOutput(snapshot, fresh.sourcePath, options, authToken),
        );
      },
    });
  }

  if (claudeCreds) {
    providers.push({
      name: "claude",
      hasCreds: true,
      run: async () => {
        const { snapshot, sourcePath } = await fetchClaudeUsage({
          force: options.force,
        });
        const authToken = options.showToken ? claudeCreds.accessToken : undefined;
        console.log(
          formatClaudeUsageOutput(snapshot, sourcePath, options, authToken),
        );
      },
    });
  }

  if (cursorCreds) {
    providers.push({
      name: "cursor",
      hasCreds: true,
      run: async () => {
        const { snapshot, sourcePath } = await fetchCursorUsage({
          force: options.force,
        });
        const authToken = options.showToken ? cursorCreds.sessionToken : undefined;
        console.log(
          formatCursorUsageOutput(snapshot, sourcePath, options, authToken),
        );
      },
    });
  }

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      await p.run();
      anyOk = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (parseCooldownSeconds(message) != null) {
        if (await printCachedStatus(p.name, options)) {
          anyOk = true;
        } else {
          anyFail = true;
          console.error(`${p.name}: ${message}`);
        }
      } else {
        anyFail = true;
        console.error(`${p.name}: ${message}`);
      }
    }
    if (i < providers.length - 1) console.log("");
  }

  if (!anyOk) {
    process.exitCode = 1;
  } else if (anyFail) {
    process.exitCode = 1;
  }
}
