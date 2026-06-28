# creditwatcher

A minimal CLI to check **Codex** and **Claude Code** subscription usage limits safely.

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
npm run login           # show login help
npm run login:codex     # Codex OAuth → ~/.creditwatcher/auth.json
npm run login:claude    # import Claude Code credentials
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
| `creditwatcher status codex` | Show Codex usage limits |
| `creditwatcher status claude` | Show Claude 5h / 7d utilization |
| `creditwatcher dashboard` | Rich terminal dashboard — Codex and Claude side by side |
| `creditwatcher dashboard --force` | Skip the 60-second usage cooldown |
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

Shows Codex and Claude side by side: plan name, auth source, usage windows (5h / weekly / 7d), reset countdown, and Codex credits. Color coding: green below 70%, yellow 70–90%, red above 90%.

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
