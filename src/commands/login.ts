import { DISCLAIMER } from "../constants.js";
import { runOAuthLogin } from "../auth/oauth.js";
import { saveCredentials } from "../auth/storage.js";
import { CLAUDE_DISCLAIMER } from "../claude/constants.js";
import { importClaudeCredentials } from "../claude/storage.js";

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

  const creds = await importClaudeCredentials();

  console.log("\n✓ Claude credentials imported");
  console.log(`  Copy saved to ~/.creditwatcher/claude-auth.json`);
  console.log(`  Source: ${creds.sourcePath}`);
  if (creds.subscriptionType) {
    console.log(`  Plan: ${creds.subscriptionType}`);
  }
}
