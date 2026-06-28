# creditwatcher

A minimal CLI to check **Codex**, **Claude Code**, and **Cursor** subscription usage limits safely.

## Install

**Global CLI** (so `creditwatcher` is on your PATH):

```bash
npm install
npm run build
npm link
```

Then run e.g. `creditwatcher status codex`.

**Without linking** (from a clone):

```bash
npm install
npm run dashboard       # rich terminal dashboard (all providers)
npm run status          # detailed text output per provider
npm run status:codex    # Codex only
npm run status:claude   # Claude only
npm run status:cursor   # Cursor only
npm run login           # show login help
npm run login:codex     # Codex OAuth → ~/.creditwatcher/auth.json
npm run login:claude    # import Claude Code credentials
npm run login:cursor    # import Cursor session from Cursor.app
npm run serve           # optional web UI at http://127.0.0.1:9477
```

**One-off** (if published or with `bin` set locally after build):

```bash
npm install && npm run build
npx creditwatcher status codex
```

## Commands

| Command | Description |
|---------|-------------|
| `creditwatcher login codex` | OAuth PKCE login via auth.openai.com |
| `creditwatcher login claude` | Import credentials from Claude Code (Keychain or `~/.claude/.credentials.json`) |
| `creditwatcher login cursor` | Import Cursor session from Cursor.app (`state.vscdb`) or paste token |
| `creditwatcher status codex` | Show Codex usage limits |
| `creditwatcher status claude` | Show Claude 5h / 7d utilization |
| `creditwatcher status cursor` | Show Cursor plan usage (included / on-demand) |
| `creditwatcher dashboard` | Rich terminal dashboard — Codex, Claude, and Cursor |
| `creditwatcher dashboard --force` | Skip the 60-second usage cooldown |
| `creditwatcher quota --json` | Machine-readable quota JSON (menu bar app) |
| `creditwatcher quota --force` | Skip cooldown for JSON output |
| `creditwatcher status` | Show all providers with credentials configured |
| `creditwatcher status --force` | Skip the 60-second usage cooldown |
| `creditwatcher serve` | Optional local web UI at http://127.0.0.1:9477 |
| `creditwatcher serve --port 3000` | Web UI on a custom port |


## Dashboard

The primary way to view usage is the **CLI dashboard** — a compact terminal view with color-coded progress bars:

```bash
npm run dashboard
# or: creditwatcher dashboard
# or: creditwatcher dashboard --force   # bypass 60s cooldown
```

Shows Codex, Claude, and Cursor: plan name, auth source, usage windows, reset countdown, and billing cycle (Cursor). Color coding: green below 70%, yellow 70–90%, red above 90%.

## macOS menu bar app

Native menu bar app (Stats-inspired) that shells out to the CLI — no direct API calls from Swift.

### Prerequisites

1. Build the CLI (bundled into the app at build time):

```bash
npm install
npm run build
```

2. Node.js 18+ on your Mac (Homebrew, nvm, or fnm — the app discovers common install paths)
3. macOS 14+ (Sonoma) and Xcode 15+

### Build

```bash
open macos/CreditWatcher.xcodeproj
# Product → Run (⌘R)
```

Or from the command line:

```bash
cd macos
xcodebuild -project CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build
```

The build copies `dist/` into the app bundle (`Contents/Resources/cli/`). If `dist/cli.js` is missing, the **Bundle CLI** build phase runs `npm run build` automatically.

The built app is at `~/Library/Developer/Xcode/DerivedData/.../Build/Products/Debug/CreditWatcher.app` when building from Xcode.

### Run

1. Launch **CreditWatcher** from Xcode (⌘R) or open the built `.app`
2. A gauge icon appears in the menu bar (no Dock icon — `LSUIElement`)
3. Click the icon to open a popover with Codex, Claude, and Cursor usage cards
4. Icon tint reflects worst-case usage: green &lt;70%, yellow 70–90%, red &gt;90%

If the popover shows an error card instead of data, see **CLI resolution** below.

**Refresh:** opens popover → auto-refresh; **Refresh** button forces `--force` (bypasses 60s cooldown). Background refresh every 60 seconds.

**CLI button:** opens Terminal with `creditwatcher dashboard --verbose`.

### Troubleshooting

**No gauge icon in the menu bar**

The app uses `NSStatusItem` (not SwiftUI `MenuBarExtra`) and sets `NSApp.setActivationPolicy(.accessory)` at launch. If the icon is still missing:

1. **Check Console.app** — filter for `CreditWatcher`. You should see:
   - `App started`
   - `Activation policy set to .accessory`
   - `Menu bar item created`
   - `Launch complete — menu bar should be visible`
2. **Quit duplicate instances** — `pkill CreditWatcher` then relaunch from Xcode (⌘R) or open the `.app` once.
3. **Menu bar overflow** — macOS may hide icons when the menu bar is full. Hold ⌘ and drag other icons away, or disable "Automatically hide and show the menu bar" temporarily.
4. **Rebuild** — `cd macos && xcodebuild -project CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build`

**`FSFindFolder failed with error=-43` in Console**

Harmless in most cases — macOS logs this when a GUI app has no working directory. The app no longer uses `FileManager.default.currentDirectoryPath` (which triggered this). Home paths use `FileManager.default.homeDirectoryForCurrentUser` instead.

**Popover shows an error instead of usage data**

See **CLI resolution** below. Console will log `CLI path: …` and `Quota result: …` or `Quota load failed: …`.

**Icon visible but popover empty**

Click the gauge icon once and wait a few seconds (Node subprocess). Check Console for `CLI stderr:` lines.

### CLI resolution

The app runs `node …/Resources/cli/cli.js quota --json`. Resolution order:

1. `CREDITWATCHER_CLI_PATH` — override in Xcode scheme (Edit Scheme → Run → Arguments → Environment Variables). Use a path to the `creditwatcher` binary or to `cli.js`.
2. **Bundled CLI** in `CreditWatcher.app/Contents/Resources/cli/` (copied from `dist/` at build time)
3. `creditwatcher` on PATH (Homebrew, nvm, etc.)
4. Dev fallback: `~/git/creditwatcher/dist/cli.js`

**Node** is resolved via Homebrew (`/opt/homebrew/bin/node`), nvm, fnm, and `/usr/local/bin/node` — Xcode does not inherit your shell PATH, so the app does not rely on `which creditwatcher` alone.

**Running from Xcode:** no `npm link` required if the **Bundle CLI** build phase succeeds. Ensure Node is installed. Optional: set `CREDITWATCHER_CLI_PATH` to your local `dist/cli.js` for faster iteration without rebuilding the bundle.

### Launch at login

**System Settings:** General → Login Items → add CreditWatcher.

**Programmatic (SMAppService):** register the app bundle with `SMAppService.mainApp` in a future release; for now use Login Items.

### JSON API

```bash
creditwatcher quota --json
# or: npm run quota
```

Returns provider cards without auth paths (safe for the menu bar UI).

### Optional web UI

For a browser-based view (future/experimental):

```bash
npm run serve
# or: creditwatcher serve --port 3000
```

Open **http://127.0.0.1:9477**. Binds to `127.0.0.1` only — no external access, no tokens in API responses.

## Claude Code setup

**Recommended (safest):** sign in with the official Claude Code CLI:

```bash
claude
creditwatcher status claude
```

creditwatcher reads Claude OAuth tokens from (in order, freshest token wins on auth failure):

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
2. macOS Keychain (`Claude Code-credentials-<hash>` or legacy `Claude Code-credentials`)
3. `~/.claude/.credentials.json`
4. `~/.creditwatcher/claude-auth.json` (import copy)

**Optional import copy:**

```bash
creditwatcher login claude
```

This copies tokens into `~/.creditwatcher/claude-auth.json` (mode 0600) without modifying Claude Code's own credential store.

### Claude safety notes

- **Read-only** `GET https://api.anthropic.com/api/oauth/usage` only
- Direct calls to `api.anthropic.com` only — no third-party relay
- Refreshes expired tokens via `POST https://platform.claude.com/v1/oauth/token` and saves rotated tokens to `~/.creditwatcher/claude-auth.json` only (never writes Claude Code's Keychain or `~/.claude/.credentials.json`)
- On-demand checks with a **60-second cooldown** (separate from Codex)
- Required headers: `Authorization`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/...`
- **OAuth scope:** `/api/oauth/usage` requires `user:profile` in the token scopes. Tokens with only `user:inference` return 401/403.
- Anthropic restricts consumer OAuth in third-party tools — **use at your own risk**

## Cursor setup

**Recommended:** sign in with the official Cursor app — creditwatcher reads the session automatically:

```bash
# Sign in via Cursor.app, then:
creditwatcher status cursor
```

Auth sources (in order):

1. `CURSOR_SESSION_TOKEN` environment variable (`WorkosCursorSessionToken` value, or JWT from `cursorAuth/accessToken`)
2. Cursor IDE SQLite state DB — `state.vscdb` key `cursorAuth/accessToken` (macOS/Linux/Windows)
3. `~/.creditwatcher/cursor-auth.json` (import copy)

**Optional import copy:**

```bash
creditwatcher login cursor
```

Reads from Cursor.app if installed; otherwise prompts to paste a session token from browser DevTools (Application → Cookies → `WorkosCursorSessionToken` on cursor.com).

### Cursor safety notes

- **Read-only** `GET https://cursor.com/api/usage-summary` and `GET https://cursor.com/api/auth/me` only
- **Unofficial API** — reverse-engineered from the Cursor dashboard; may change without notice
- Session tokens stay **local only** — never logged or sent to third parties
- On-demand checks with a **60-second cooldown** (separate from Codex/Claude)
- No official Cursor API exists — **use at your own risk**

## Setup

**Recommended (safest):** use the official Codex CLI login:

```bash
codex login
creditwatcher status
```

creditwatcher reads `~/.codex/auth.json` first (official CLI auth), then falls back to `~/.creditwatcher/auth.json`.

**Alternative:** login directly via creditwatcher:

```bash
npm run login
# or: npx tsx src/cli.ts login codex
```

Tokens are stored in `~/.creditwatcher/auth.json` (mode 0600).

## What it does

- **Read-only** `GET https://chatgpt.com/backend-api/wham/usage`
- Refreshes OAuth tokens via `https://auth.openai.com/oauth/token` when expired
- Displays plan type, 5-hour window, weekly window, and credits balance
- Stores tokens **locally only** — never sent to third-party servers

## What it does NOT do

- Proxy inference requests (no `/codex` or `/responses` calls)
- Scrape the ChatGPT web UI
- Send tokens to any server except OpenAI (`auth.openai.com`, `chatgpt.com`)
- Background polling (on-demand only; max once per 60 seconds)
- Log or print access/refresh tokens

## Safety & Terms of Service

### Why this exists

Developers want to see Codex quota usage without opening ChatGPT settings. This tool follows patterns used by the official Codex CLI, OpenClaw, CodexBar, and similar **read-only usage checkers**.

### OpenAI / Codex

OpenAI has been **more permissive** than Anthropic about third-party tools using Codex OAuth tokens for external clients (as of early 2026). The official Codex CLI uses a **public OAuth client_id** (`app_EMoamEEZ73f0CkXaXp7hrann`) and the same PKCE flow implemented here.

Still, **use at your own risk**. This is an unofficial tool not endorsed by OpenAI.

### What gets accounts banned (Jan 2026 context)

Reports from Anthropic's OAuth crackdown (OpenCode, etc.) highlight patterns that trigger enforcement:

| Risky pattern | Why it's banned |
|---------------|-----------------|
| **Spoofing official client harness** | Pretending to be Claude Code to route subscription quota through third-party agents |
| **Credential exfiltration** | Sending OAuth tokens to third-party servers |
| **Inference proxying** | Using subscription tokens to serve API requests for other users/tools |
| **Aggressive polling** | Hammering usage/auth endpoints (abuse filter triggers) |
| **Token sharing** | Distributing refresh tokens across machines/users |

Anthropic explicitly prohibits consumer OAuth in third-party tools. OpenAI's stance on Codex third-party usage is more open, but abusive patterns can still trigger account action.

### Safe patterns this tool follows

| Pattern | Implementation |
|---------|----------------|
| Read-only usage endpoint | `GET /wham/usage` only |
| Official OAuth PKCE flow | Same client_id, scopes, redirect as Codex CLI |
| Local token storage | `~/.creditwatcher/auth.json` or `~/.codex/auth.json` |
| Direct OpenAI calls only | No third-party relay |
| On-demand checks | 60-second cooldown between usage requests |
| No token logging | Tokens never printed to stdout/stderr |
| Prefer existing Codex CLI auth | Reads `~/.codex/auth.json` first |

### What to avoid

- Do not use this (or any tool) to **proxy Codex inference** for other apps
- Do not **poll usage every few seconds** — once per minute max, on-demand preferred
- Do not **upload auth.json** anywhere
- Do not run multiple instances doing concurrent OAuth on port 1455

## OAuth details

Matches the official Codex CLI (verified from openresponses/codex and opencode sources):

- **Client ID:** `app_EMoamEEZ73f0CkXaXp7hrann` (public, shipped with Codex CLI)
- **Authorize:** `https://auth.openai.com/oauth/authorize`
- **Token:** `https://auth.openai.com/oauth/token`
- **Redirect:** `http://localhost:1455/auth/callback`
- **Scopes:** `openid profile email offline_access api.connectors.read api.connectors.invoke`
- **Extra params:** `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_HOME` | `~/.codex` | Where to find Codex CLI auth.json |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where to find Claude `.credentials.json` |
| `CURSOR_SESSION_TOKEN` | — | Cursor `WorkosCursorSessionToken` cookie value |
| `CURSOR_STATE_DB` | platform default | Override path to Cursor `state.vscdb` |
| `CREDITWATCHER_OAUTH_PORT` | `1455` | OAuth callback port |

## Example output

### Dashboard

```
┌─ CreditWatcher ──────────────────────────────────────────────────┐
│ Codex (plus)                     │ Claude (max)                  │
│ Auth: ~/.codex/auth.json         │ Auth: ~/.claude/.credentials… │
│ 5h  ████░░░░░░ 33% ↻2h 15m       │ 5h  ████░░░░░░ 42% ↻1h 12m   │
│ wk  ██░░░░░░░░ 12% ↻5d 3h        │ 7d  █░░░░░░░░░  8% ↻4d 6h   │
│ Credits: $42.00                  │                               │
└──────────────────────────────────────────────────────────────────┘
Updated 3:42:15 PM
```

### Status (detailed)
⚠️  Safety notice: creditwatcher only reads your usage limits via GET /wham/usage.
   Tokens stay on your machine. No inference proxying. Use at your own risk.
   Prefer logging in with the official `codex login` and reading ~/.codex/auth.json.

Codex usage — plus
Auth: /Users/you/.codex/auth.json

5-hour   ████░░░░░░░░ 33.0% used (67.0% left) · resets in 2h 15m
weekly   ██░░░░░░░░░░ 12.0% used (88.0% left) · resets in 5d 3h
```



### Claude example output

```
Claude usage — max
Auth: /Users/you/.claude/.credentials.json

5-hour         ████░░░░░░░░ 42.0% used (58.0% left) · resets in 1h 12m
7-day          ██░░░░░░░░░░ 8.0% used (92.0% left) · resets in 4d 6h
7-day Sonnet   █░░░░░░░░░░░ 5.0% used (95.0% left) · resets in 4d 6h
```

## License

MIT
