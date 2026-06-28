import { DISCLAIMER } from "../constants.js";
import { runOAuthLogin } from "../auth/oauth.js";
import { saveCredentials } from "../auth/storage.js";
import { CLAUDE_DISCLAIMER } from "../claude/constants.js";
import { fetchClaudeUsage } from "../claude/usage.js";
import {
  importClaudeCredentials,
  loadClaudeCredentials,
} from "../claude/storage.js";
import { CURSOR_DISCLAIMER } from "../cursor/constants.js";
import { fetchCursorUsage } from "../cursor/usage.js";
import {
  importCursorCredentials,
  loadCursorCredentials,
  saveCursorCredentialsCopy,
} from "../cursor/storage.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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

export async function loginCursor(): Promise<void> {
  console.log(CURSOR_DISCLAIMER);
  console.log("");
  console.log(
    "Importing session from Cursor app (state.vscdb) or CURSOR_SESSION_TOKEN...",
  );
  console.log("");

  let existing = await loadCursorCredentials();
  if (!existing) {
    const rl = readline.createInterface({ input, output });
    try {
      const pasted = (
        await rl.question(
          "Paste WorkosCursorSessionToken (or press Enter to skip): ",
        )
      ).trim();
      if (pasted) {
        const saved = await saveCursorCredentialsCopy({
          sessionToken: pasted,
          sourcePath: "manual paste",
        });
        existing = saved;
      }
    } finally {
      rl.close();
    }
  }

  if (!existing) {
    throw new Error(
      "No Cursor session found. Sign in to the Cursor app, set CURSOR_SESSION_TOKEN, or paste a session token.",
    );
  }

  console.log(`  Found: ${existing.sourcePath}`);
  const creds = await importCursorCredentials();
  console.log(`  Source: ${creds.sourcePath}`);

  console.log("Verifying with a test usage request...");
  const { snapshot, sourcePath } = await fetchCursorUsage({ force: true });
  console.log(formatCursorVerifyOutput(snapshot, sourcePath));
}

function formatCursorVerifyOutput(
  snapshot: { membershipType?: string; email?: string; windows: unknown[] },
  sourcePath: string,
): string {
  const plan = snapshot.membershipType ?? "Cursor";
  const account = snapshot.email ? ` (${snapshot.email})` : "";
  const lines = [
    "",
    "✓ Cursor credentials verified",
    `  Auth: ${sourcePath}`,
    `  Plan: ${plan}${account}`,
    `  Usage windows: ${snapshot.windows.length}`,
  ];
  return lines.join("\n");
}
