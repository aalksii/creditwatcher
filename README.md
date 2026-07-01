# CreditWatcher

[License: MIT](LICENSE)
[Node.js](package.json)

A **macOS menu bar app** and **CLI** to monitor **Codex**, **Claude Code**, and **Cursor** subscription usage limits — locally, read-only, with no telemetry.

Inspired by the design spirit of [Stats](https://github.com/exelban/stats) (lightweight macOS menu bar utility).

**[Download CreditWatcher for macOS](https://github.com/aalksii/creditwatcher/releases/download/v0.1.1/CreditWatcher-0.1.1.dmg)**

Prebuilt installers are published through [GitHub Releases](https://github.com/aalksii/creditwatcher/releases).

## Screenshots



## Features

- **Three providers** — Codex (OpenAI), Claude Code (Anthropic), Cursor in one place
- **macOS menu bar app** — native Swift; Node.js is only needed for CLI features
- **CLI dashboard** — rich terminal view with color-coded progress bars
- **Read-only usage checks** — never proxies inference or scrapes web UIs
- **Local credentials** — reads existing logins from official tools; tokens stay on your machine
- **Shared cache** — CLI and menu bar app share `~/.creditwatcher/` quota cache
- **60-second cooldown** — on-demand refresh, avoids hammering provider APIs
- **Optional local web UI** — `creditwatcher serve` on `127.0.0.1` only



## Privacy & security

CreditWatcher is designed to be local-first:


| Data                   | Where it lives                                                 |
| ---------------------- | -------------------------------------------------------------- |
| OAuth / session tokens | Read from local files only (menu bar app never reads Keychain) |
| Usage responses        | Cached under `~/.creditwatcher/`                               |
| Network calls          | Direct to official provider APIs only                          |


- **No telemetry** — no analytics, crash reporters, or third-party servers
- **No token logging** — access/refresh tokens are not printed in normal operation
- **No Keychain in the menu bar app** — Claude auth uses JSON files and env vars only; no macOS Keychain prompts from the app
- **Optional CLI import** — `creditwatcher login claude` may read Keychain once in Terminal to copy credentials into `~/.creditwatcher/claude-auth.json`
- **Sandbox-free macOS app** — required to read local credential stores and call provider APIs; see [SECURITY.md](SECURITY.md)



## Prerequisites

- **macOS app:** macOS 14+ (Sonoma)
- **CLI features:** Node.js 18+ı
- **Build from source:** Node.js 18+ and Xcode 15+
- **Provider logins:** sign in with official tools first (`codex login`, `claude`, Cursor.app)



## Install

There are two ways to install CreditWatcher:

### Option 1: Download the DMG

Download the latest DMG from [GitHub Releases](https://github.com/aalksii/creditwatcher/releases), open it, and drag **CreditWatcher** to **Applications**.

The DMG bundles the Node CLI inside `CreditWatcher.app`. On launch from outside the installer volume, the app tries to install a `creditwatcher` shim into a writable terminal PATH directory such as `/opt/homebrew/bin`, `/usr/local/bin`, or `~/.local/bin`. It will not overwrite an existing non-CreditWatcher command.

Node.js 18+ is required for the bundled CLI and the in-app **CLI** button.

### Option 2: Build from Source

```bash
git clone https://github.com/aalksii/creditwatcher.git
cd creditwatcher
npm install
npm run build
npm link   # optional — install `creditwatcher` on your PATH
```

Without linking:

```bash
npm run dashboard       # rich terminal dashboard (all providers)
npm run status          # detailed text output per provider
npm run quota           # JSON output (used by menu bar integration)
```

Build the macOS menu bar app:

```bash
open macos/CreditWatcher.xcodeproj
# Product → Run (⌘R)
```

Or from the command line:

```bash
xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build
```

The built app is under Xcode DerivedData or `build/` when using `xcodebuild`.

### Build a Local DMG

For a local drag-to-Applications installer:

```bash
npm run macos:dmg
```

The DMG is written to `dist/macos/CreditWatcher-<version>.dmg`.

For a clean local reinstall test:

```bash
npm run macos:uninstall -- --dry-run
npm run macos:uninstall
npm run macos:dmg
```

`macos:uninstall` removes `/Applications/CreditWatcher.app` and CreditWatcher-owned CLI shims only. It keeps `~/.creditwatcher` unless you pass `--cache`.

For public distribution, sign and notarize it with an Apple Developer ID:

```bash
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="notarytool-profile" \
npm run macos:dmg
```

Create the `notarytool` profile once with `xcrun notarytool store-credentials`.

## Usage



### CLI


| Command                                      | Description                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `creditwatcher dashboard`                    | Rich terminal dashboard — all providers                                 |
| `creditwatcher dashboard --force`            | Skip the 60-second usage cooldown                                       |
| `creditwatcher status [codex|claude|cursor]` | Detailed usage per provider                                             |
| `creditwatcher quota --json`                 | Machine-readable quota JSON                                             |
| `creditwatcher login [codex|claude|cursor]`  | Import or OAuth login helpers                                           |
| `creditwatcher serve`                        | Optional local web UI at [http://127.0.0.1:9477](http://127.0.0.1:9477) |


Example:

```bash
creditwatcher dashboard
creditwatcher status claude
creditwatcher quota --json
```



### macOS menu bar app

1. Launch **CreditWatcher** from Xcode (⌘R) or open the built `.app`
2. A gauge icon appears in the menu bar (no Dock icon)
3. Click the icon for a popover with Codex, Claude, and Cursor usage cards
4. Use the gear button to show/hide providers, reorder cards, and sign in or out per tool
5. Icon tint reflects worst-case usage: system default <70%, yellow 70–90%, red >90%

**Refresh:** auto-refresh on open; **Refresh** button bypasses the 60s cooldown. Background refresh every 60 seconds.

**Quit:** click **Quit** in the popover or right-click the menu bar icon and choose **Quit CreditWatcher**.

**Launch at login:** System Settings → General → Login Items → add CreditWatcher.

**CLI button:** opens Terminal with the bundled CLI dashboard. Node.js 18+ is still required.

## Provider setup

Sign in with the official tools first. CreditWatcher reads existing credentials — it does not replace them.

### Codex (OpenAI)

**Recommended:**

```bash
codex login
creditwatcher status codex
```

Auth order:

1. `~/.codex/auth.json` (official Codex CLI)
2. `~/.creditwatcher/auth.json` (via `creditwatcher login codex`)



### Claude Code (Anthropic)

**Recommended (menu bar app):**

```bash
claude                              # sign in with Claude Code if needed
creditwatcher login claude          # import into ~/.creditwatcher/claude-auth.json
```

Then click **Refresh** in the menu bar app.

Auth order for automatic usage checks (freshest token wins on auth failure):

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
2. `~/.claude/.credentials.json`
3. `~/.creditwatcher/claude-auth.json` (import copy via `creditwatcher login claude`)

The menu bar app reads only the sources above. For Claude Code installs that store credentials in Keychain (no credentials file), run `creditwatcher login claude` in Terminal — the CLI may read Keychain once there and save a file copy the app can use.

### Cursor

**Recommended:** sign in via Cursor.app, then:

```bash
creditwatcher status cursor
```

Auth order:

1. `CURSOR_SESSION_TOKEN` environment variable
2. Cursor IDE SQLite state DB — `state.vscdb` key `cursorAuth/accessToken`
3. `~/.creditwatcher/cursor-auth.json` (import copy via `creditwatcher login cursor`)



## Architecture

```
CreditWatcher.app (Swift)          creditwatcher CLI (Node.js)
├── CodexProvider                  ├── src/codex/
├── ClaudeProvider                 ├── src/claude/
└── CursorProvider                 └── src/cursor/
         │                                    │
         └──────── shared cache ──────────────┘
                  ~/.creditwatcher/
```

The native app calls provider APIs directly via `URLSession`. Node.js is required only for CLI commands and the bundled terminal dashboard.

## Environment variables


| Variable                   | Default          | Description                           |
| -------------------------- | ---------------- | ------------------------------------- |
| `CODEX_HOME`               | `~/.codex`       | Codex CLI auth directory              |
| `CLAUDE_CONFIG_DIR`        | `~/.claude`      | Claude credentials directory          |
| `CURSOR_SESSION_TOKEN`     | —                | Cursor session cookie value           |
| `CURSOR_STATE_DB`          | platform default | Override path to Cursor `state.vscdb` |
| `CREDITWATCHER_OAUTH_PORT` | `1455`           | OAuth callback port (Codex login)     |




## Disclaimer

**CreditWatcher is unofficial and not endorsed by OpenAI, Anthropic, or Cursor.**

- Usage APIs may change without notice (especially Cursor's unofficial endpoints)
- Third-party tools using consumer OAuth may violate provider Terms of Service
- Anthropic has restricted consumer OAuth in third-party tools — **use Claude integration at your own risk**
- This tool performs **read-only** usage checks — do not use it to proxy inference or share tokens
- **Use at your own risk** — the authors are not responsible for account actions by providers

See the [Safety & Terms of Service](#safety--terms-of-service) section in this README for details on safe usage patterns.

## Roadmap

- [ ] Pre-built macOS release (signed `.app` / Homebrew cask)
- [ ] Demo GIF for README
- [ ] npm publish for optional global CLI install
- [ ] Clearer refresh timing and near-limit warnings in the menu bar UI
- [ ] Multiple accounts/workspaces per provider
- [ ] Usage estimator for long-running agent/coding sessions



## Safety & Terms of Service



### What this tool does

- **Read-only** usage endpoints only (`GET /wham/usage`, `/api/oauth/usage`, `/api/usage-summary`)
- Refreshes expired OAuth tokens via official token endpoints when needed
- Stores tokens **locally only**
- On-demand checks with a **60-second cooldown** per provider
- Direct calls to provider APIs — no third-party relay



### What this tool does NOT do

- Proxy inference requests
- Scrape ChatGPT or Claude web UIs
- Send tokens to any server except the official provider APIs
- Background polling beyond the 60s refresh interval
- Log or print access/refresh tokens



### Risky patterns to avoid


| Pattern                          | Why it's risky                                        |
| -------------------------------- | ----------------------------------------------------- |
| Spoofing official client harness | Routing subscription quota through third-party agents |
| Credential exfiltration          | Sending OAuth tokens to third-party servers           |
| Inference proxying               | Using subscription tokens for other users/tools       |
| Aggressive polling               | Hammering usage endpoints                             |
| Token sharing                    | Distributing refresh tokens across machines           |




## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues via [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — Copyright (c) 2026 Aleksei Artemiev

## Credits

- UI inspiration: [Stats](https://github.com/exelban/stats) by [exelban](https://github.com/exelban)
- Codex OAuth flow aligned with the official Codex CLI patterns
