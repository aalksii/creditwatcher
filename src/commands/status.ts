import { DISCLAIMER } from "../constants.js";
import { ensureFreshCredentials } from "../auth/refresh.js";
import { loadCredentials } from "../auth/storage.js";
import { CLAUDE_DISCLAIMER } from "../claude/constants.js";
import { fetchClaudeUsage, formatClaudeUsageOutput } from "../claude/usage.js";
import { loadClaudeCredentials } from "../claude/storage.js";
import { fetchUsage, formatUsageOutput } from "../codex/usage.js";
import { formatProviderStatusBlock } from "../dashboard/terminal.js";
import { getQuota, parseCooldownSeconds } from "../server/quota.js";

async function printCachedStatus(
  provider: "codex" | "claude",
  options: { force?: boolean },
): Promise<boolean> {
  const quota = await getQuota({ force: options.force });
  const data = provider === "codex" ? quota.codex : quota.claude;
  if (data.cached) {
    console.log(formatProviderStatusBlock(data));
    return true;
  }
  return false;
}

export async function statusCodex(options: { force?: boolean } = {}): Promise<boolean> {
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

  try {
    const fresh = await ensureFreshCredentials(creds);
    const snapshot = await fetchUsage(fresh, { force: options.force });
    console.log(formatUsageOutput(snapshot, fresh.sourcePath));
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

export async function statusClaude(options: { force?: boolean } = {}): Promise<boolean> {
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

  try {
    const { snapshot, sourcePath } = await fetchClaudeUsage({
      force: options.force,
    });
    console.log(formatClaudeUsageOutput(snapshot, sourcePath));
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

export async function statusAll(options: { force?: boolean } = {}): Promise<void> {
  const codexCreds = await loadCredentials();
  const claudeCreds = await loadClaudeCredentials();

  if (!codexCreds && !claudeCreds) {
    console.error("Not logged in to any provider.");
    console.error("");
    console.error("Codex: `codex login` or `creditwatcher login codex`");
    console.error(
      "Claude: `claude` sign-in or `creditwatcher login claude`",
    );
    process.exitCode = 1;
    return;
  }

  console.log(DISCLAIMER);
  console.log(CLAUDE_DISCLAIMER);
  console.log("");

  let anyOk = false;
  let anyFail = false;

  if (codexCreds) {
    try {
      const fresh = await ensureFreshCredentials(codexCreds);
      const snapshot = await fetchUsage(fresh, { force: options.force });
      console.log(formatUsageOutput(snapshot, fresh.sourcePath));
      anyOk = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (parseCooldownSeconds(message) != null) {
        if (await printCachedStatus("codex", options)) {
          anyOk = true;
        } else {
          anyFail = true;
          console.error(`Codex: ${message}`);
        }
      } else {
        anyFail = true;
        console.error(`Codex: ${message}`);
      }
    }
    if (claudeCreds) console.log("");
  }

  if (claudeCreds) {
    try {
      const { snapshot, sourcePath } = await fetchClaudeUsage({
        force: options.force,
      });
      console.log(formatClaudeUsageOutput(snapshot, sourcePath));
      anyOk = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (parseCooldownSeconds(message) != null) {
        if (await printCachedStatus("claude", options)) {
          anyOk = true;
        } else {
          anyFail = true;
          console.error(`Claude: ${message}`);
        }
      } else {
        anyFail = true;
        console.error(`Claude: ${message}`);
      }
    }
  }

  if (!anyOk) {
    process.exitCode = 1;
  } else if (anyFail) {
    process.exitCode = 1;
  }
}
