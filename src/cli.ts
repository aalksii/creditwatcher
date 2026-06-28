#!/usr/bin/env node

import { dashboardCommand } from "./commands/dashboard.js";
import { loginClaude, loginCodex, loginCursor } from "./commands/login.js";
import { quotaCommand } from "./commands/quota.js";
import { serveCommand } from "./commands/serve.js";
import {
  statusAll,
  statusClaude,
  statusCodex,
  statusCursor,
} from "./commands/status.js";

function printLoginHelp(): void {
  console.log(`Usage:
  creditwatcher login codex      OAuth login (stores ~/.creditwatcher/auth.json)
  creditwatcher login claude     Import ~/.claude/.credentials.json
  creditwatcher login cursor     Import Cursor session from Cursor.app or paste token

npm scripts:
  npm run login:codex            Same as login codex
  npm run login:claude           Same as login claude
  npm run login:cursor           Same as login cursor
  npm run login                  Show this help`);
}

function printStatusHelp(): void {
  console.log(`Usage:
  creditwatcher status           Show all configured providers
  creditwatcher status codex     Show Codex usage limits
  creditwatcher status claude    Show Claude usage limits
  creditwatcher status cursor    Show Cursor usage limits
  creditwatcher status --force   Bypass 60s usage check cooldown
  creditwatcher status --verbose   Show auth source paths
  creditwatcher status --show-token  Show auth paths and tokens (sensitive)

npm scripts:
  npm run status                 Same as status
  npm run status:codex           Same as status codex
  npm run status:claude          Same as status claude
  npm run status:cursor          Same as status cursor`);
}

function printDashboardHelp(): void {
  console.log(`Usage:
  creditwatcher dashboard           Rich terminal view of all providers
  creditwatcher dashboard --force   Bypass 60s usage check cooldown
  creditwatcher dashboard --verbose Show auth source paths
  creditwatcher dashboard --show-token  Show auth paths and tokens (sensitive)

npm scripts:
  npm run dashboard                 Same as dashboard`);
}

function printServeHelp(): void {
  console.log(`Usage:
  creditwatcher serve              Optional web UI at http://127.0.0.1:9477
  creditwatcher serve --port 3000  Use a custom port

npm scripts:
  npm run serve                    Same as serve`);
}

function printHelp(): void {
  console.log(`creditwatcher — check Codex, Claude, and Cursor usage limits safely

Usage:
  creditwatcher login codex      OAuth login (stores ~/.creditwatcher/auth.json)
  creditwatcher login claude     Import ~/.claude/.credentials.json
  creditwatcher login cursor     Import Cursor session from Cursor.app
  creditwatcher status codex     Show Codex usage limits
  creditwatcher status claude    Show Claude usage limits
  creditwatcher status cursor    Show Cursor usage limits
  creditwatcher quota --json       Machine-readable quota (menu bar app)
  creditwatcher quota --force      Bypass 60s usage check cooldown
  creditwatcher dashboard        Rich terminal dashboard (all providers)
  creditwatcher dashboard --force  Bypass 60s usage check cooldown
  creditwatcher dashboard --verbose  Show auth source paths
  creditwatcher dashboard --show-token  Show auth paths and tokens (sensitive)
  creditwatcher status           Show all configured providers
  creditwatcher status --force   Bypass 60s usage check cooldown
  creditwatcher status --verbose Show auth source paths
  creditwatcher status --show-token  Show auth paths and tokens (sensitive)
  creditwatcher serve            Optional web UI (127.0.0.1:9477)
  creditwatcher serve --port N   Web UI on custom port

Environment:
  CREDITWATCHER_OAUTH_PORT       OAuth callback port for Codex (default: 1455)
  CODEX_HOME                     Path to Codex config (default: ~/.codex)
  CLAUDE_CONFIG_DIR              Path to Claude config (default: ~/.claude)
  CURSOR_SESSION_TOKEN           Cursor WorkosCursorSessionToken (sub::jwt)
  CURSOR_STATE_DB                Override path to Cursor state.vscdb

Safety:
  Read-only usage endpoints only. Tokens stay local. No inference proxying.
  Prefer official CLIs: \`codex login\`, \`claude\` sign-in, Cursor app sign-in.
  Cursor uses unofficial read-only cursor.com endpoints — use at your own risk.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const showToken = args.includes("--show-token");
  const displayOptions = { verbose, showToken };
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
        } else if (provider === "cursor") {
          await loginCursor();
        } else {
          console.error(
            `Unknown provider: ${provider}. Use: login codex | login claude | login cursor`,
          );
          printLoginHelp();
          process.exitCode = 1;
        }
        break;

      case "status":
        if (!provider) {
          await statusAll({ force, ...displayOptions });
        } else if (provider === "codex") {
          const ok = await statusCodex({ force, ...displayOptions });
          if (!ok) process.exitCode = 1;
        } else if (provider === "claude") {
          const ok = await statusClaude({ force, ...displayOptions });
          if (!ok) process.exitCode = 1;
        } else if (provider === "cursor") {
          const ok = await statusCursor({ force, ...displayOptions });
          if (!ok) process.exitCode = 1;
        } else {
          console.error(`Unknown provider: ${provider}`);
          printStatusHelp();
          process.exitCode = 1;
        }
        break;

      case "quota": {
        const quotaArgs = args.filter((a) => !a.startsWith("-") && a !== "quota");
        if (quotaArgs.length > 0) {
          console.error(`Ignoring extra argument(s): ${quotaArgs.join(", ")}`);
        }
        await quotaCommand({ force, json });
        break;
      }

      case "dashboard": {
        const dashArgs = args.filter((a) => !a.startsWith("-") && a !== "dashboard");
        if (dashArgs.length > 0) {
          console.error(`Ignoring extra argument(s): ${dashArgs.join(", ")}`);
        }
        if (args.includes("--help")) {
          printDashboardHelp();
          break;
        }
        await dashboardCommand({ force, ...displayOptions });
        break;
      }

      case "serve": {
        const serveArgs = args.filter((a) => !a.startsWith("-") && a !== "serve");
        if (serveArgs.length > 0) {
          console.error(`Ignoring extra argument(s): ${serveArgs.join(", ")}`);
        }
        const portArgs = args.filter((a) => a !== "serve");
        if (portArgs.includes("--help")) {
          printServeHelp();
          break;
        }
        await serveCommand(portArgs);
        break;
      }

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
