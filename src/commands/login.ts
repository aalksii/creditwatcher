import { DISCLAIMER } from "../constants.js";
import { runOAuthLogin } from "../auth/oauth.js";
import { saveCredentials } from "../auth/storage.js";
import { CLAUDE_DISCLAIMER } from "../claude/constants.js";
import { fetchClaudeUsage } from "../claude/usage.js";
import {
  importClaudeCredentials,
  loadClaudeCredentials,
} from "../claude/storage.js";

export async function loginCodex(): Promise<void> {
  console.log(DISCLAIMER);
  console.log("");

  const creds = await runOAuthLogin();
  await saveCredentials(creds);

  console.log("\n✓ Logged in successfully");
  console.log(`  Tokens saved to ~/.creditwatcher/auth.json`);
  if (creds.accountId) {
    console.log(`  Account: ${creds.accountId}`);
  }
}

export async function loginClaude(): Promise<void> {
  console.log(CLAUDE_DISCLAIMER);
  console.log("");
  console.log(
    "Importing credentials from Claude Code (Keychain or ~/.claude/.credentials.json)...",
  );
  console.log("");

  const existing = await loadClaudeCredentials();
  if (!existing) {
    throw new Error(
      "No Claude Code credentials found. Run `claude` and sign in first, then retry.",
    );
  }

  console.log(`  Found: ${existing.sourcePath}`);
  const creds = await importClaudeCredentials();
  console.log(`  Source: ${creds.sourcePath}`);

  console.log("Verifying with a test usage request...");
  const { snapshot, sourcePath } = await fetchClaudeUsage({ force: true });
  console.log(formatClaudeVerifyOutput(snapshot, sourcePath));
}

function formatClaudeVerifyOutput(
  snapshot: { subscriptionType?: string; windows: unknown[] },
  sourcePath: string,
): string {
  const plan = snapshot.subscriptionType ?? "Claude";
  const lines = [
    "",
    "✓ Claude credentials verified",
    `  Auth: ${sourcePath}`,
    `  Plan: ${plan}`,
    `  Usage windows: ${snapshot.windows.length}`,
  ];
  return lines.join("\n");
}
