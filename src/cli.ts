#!/usr/bin/env node

import { loginClaude, loginCodex } from "./commands/login.js";
import { statusAll, statusClaude, statusCodex } from "./commands/status.js";

function printHelp(): void {
  console.log(`creditwatcher — check Codex and Claude usage limits safely

Usage:
  creditwatcher login codex      OAuth login (stores ~/.creditwatcher/auth.json)
  creditwatcher login claude     Import ~/.claude/.credentials.json (or Keychain)
  creditwatcher status codex     Show Codex usage limits
  creditwatcher status claude    Show Claude usage limits
  creditwatcher status           Show all configured providers
  creditwatcher status --force   Bypass 60s usage check cooldown

Environment:
  CREDITWATCHER_OAUTH_PORT       OAuth callback port for Codex (default: 1455)
  CODEX_HOME                     Path to Codex config (default: ~/.codex)
  CLAUDE_CONFIG_DIR              Path to Claude config (default: ~/.claude)

Safety:
  Read-only usage endpoints only. Tokens stay local. No inference proxying.
  Prefer official CLIs: \`codex login\`, \`claude\` sign-in.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("-"));

  if (positional.length === 0 || positional.includes("help") || args.includes("--help")) {
    printHelp();
    return;
  }

  const [command, provider] = positional;

  try {
    switch (command) {
      case "login":
        if (provider === "codex") {
          await loginCodex();
        } else if (provider === "claude") {
          await loginClaude();
        } else {
          console.error(
            `Unknown provider: ${provider ?? "(none)"}. Use: login codex | login claude`,
          );
          process.exitCode = 1;
        }
        break;

      case "status":
        if (!provider) {
          await statusAll({ force });
        } else if (provider === "codex") {
          const ok = await statusCodex({ force });
          if (!ok) process.exitCode = 1;
        } else if (provider === "claude") {
          const ok = await statusClaude({ force });
          if (!ok) process.exitCode = 1;
        } else {
          console.error(`Unknown provider: ${provider}`);
          process.exitCode = 1;
        }
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

main();
