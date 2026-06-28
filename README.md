# creditwatcher

A minimal CLI to check **Codex** and **Claude Code** subscription usage limits safely.

```bash
npm install
npm run status          # check all configured providers
npm run login           # Codex OAuth → ~/.creditwatcher/auth.json
npm run login:claude    # import Claude Code credentials
```

## Commands

| Command | Description |
|---------|-------------|
| `creditwatcher login codex` | OAuth PKCE login via auth.openai.com |
| `creditwatcher login claude` | Import credentials from Claude Code (Keychain or `~/.claude/.credentials.json`) |
| `creditwatcher status codex` | Show Codex usage limits |
| `creditwatcher status claude` | Show Claude 5h / 7d utilization |
| `creditwatcher status` | Show all providers with credentials configured |
| `creditwatcher status --force` | Skip the 60-second usage cooldown |


## Claude Code setup

**Recommended (safest):** sign in with the official Claude Code CLI:

```bash
claude
creditwatcher status claude
```

creditwatcher reads Claude OAuth tokens from (in order):

1. macOS Keychain (`Claude Code-credentials`)
2. `~/.claude/.credentials.json`
3. `~/.creditwatcher/claude-auth.json` (import copy)

**Optional import copy:**

```bash
creditwatcher login claude
```

This copies tokens into `~/.creditwatcher/claude-auth.json` (mode 0600) without modifying Claude Code's own credential store.

### Claude safety notes

- **Read-only** `GET https://api.anthropic.com/api/oauth/usage` only
- Direct calls to `api.anthropic.com` only — no third-party relay
- **Never** refresh or rewrite Claude Code's Keychain / `~/.claude/.credentials.json` (avoids desyncing the official CLI)
- On-demand checks with a **60-second cooldown** (separate from Codex)
- Required headers: `Authorization`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/...`
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

```
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
