#!/usr/bin/env node

import { loginClaude, loginCodex } from "./commands/login.js";
import { statusAll, statusClaude, statusCodex } from "./commands/status.js";

function printLoginHelp(): void {
  console.log(`Usage:
  creditwatcher login codex      OAuth login (stores ~/.creditwatcher/auth.json)
  creditwatcher login claude     Import Claude Code credentials (Keychain or ~/.claude/.credentials.json)

npm scripts:
  npm run login:codex            Same as login codex
  npm run login:claude           Same as login claude
  npm run login                  Show this help`);
}

function printStatusHelp(): void {
  console.log(`Usage:
  creditwatcher status           Show all configured providers
  creditwatcher status codex     Show Codex usage limits
  creditwatcher status claude    Show Claude usage limits
  creditwatcher status --force   Bypass 60s usage check cooldown

npm scripts:
  npm run status                 Same as status
  npm run status:codex           Same as status codex
  npm run status:claude          Same as status claude`);
}

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

  const [command, provider, ...extra] = positional;

  if (extra.length > 0) {
    console.error(
      `Ignoring extra argument(s): ${extra.join(", ")}. Use npm run login:claude or creditwatcher login claude (not npm run login claude with the old codex script).`,
    );
  }

  try {
    switch (command) {
      case "login":
        if (!provider) {
          printLoginHelp();
          process.exitCode = 1;
        } else if (provider === "codex") {
          await loginCodex();
        } else if (provider === "claude") {
          await loginClaude();
        } else {
          console.error(
            `Unknown provider: ${provider}. Use: login codex | login claude`,
          );
          printLoginHelp();
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
          printStatusHelp();
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
