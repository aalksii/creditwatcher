# CreditWatcher

[License: MIT](LICENSE)

A native **macOS menu bar app** to monitor **Codex**, **Claude Code**, and **Cursor** subscription usage limits locally, read-only, with no telemetry.

Inspired by the design spirit of [Stats](https://github.com/exelban/stats): a lightweight utility that lives quietly in the menu bar.

**[Download CreditWatcher for macOS](https://github.com/aalksii/creditwatcher/releases/download/v0.2.0/CreditWatcher-0.2.0.dmg)**

## Important: Claude Keychain Access

Claude Code support may require macOS Keychain access. When you choose **Settings → Claude → Sign In**, macOS can ask whether CreditWatcher may read the Claude Code credential item.

Allowing this is required only for importing Claude Code credentials from Keychain. After you connect Claude, CreditWatcher refreshes Claude tokens automatically when the saved refresh token is still valid. Normal background refreshes use a non-interactive Keychain fallback and will not pop up permission dialogs. CreditWatcher cannot perform a fresh Claude login for you if Claude Code itself is signed out or Anthropic rejects the refresh token. If you skip Claude, it is hidden and the app will not keep asking.

## Features

- **Three providers** — Codex, Claude Code, and Cursor usage in one popover
- **Native macOS app** — Swift menu bar app; no Node.js required for the DMG
- **In-app sign-in/import** — connect providers from Settings, without running CreditWatcher commands in Terminal
- **Read-only usage checks** — calls provider usage APIs directly; never proxies inference
- **Local credentials** — tokens stay on your Mac
- **Shared local cache** — quota responses are cached under `~/.creditwatcher/`
- **60-second cooldown** — avoids hammering provider APIs

## Privacy & Security

CreditWatcher is local-first:

| Data | Where it lives |
| --- | --- |
| Codex OAuth tokens | `~/.creditwatcher/auth.json`, or existing `~/.codex/auth.json` |
| Claude credentials | Claude Code local credentials, macOS Keychain import, or `~/.creditwatcher/claude-auth.json` |
| Cursor session | Cursor app local SQLite state DB |
| Usage responses | `~/.creditwatcher/` |

- **No telemetry** — no analytics, crash reporting, or third-party relay servers
- **No token logging** — access and refresh tokens are not printed in normal operation
- **Direct provider calls only** — usage requests go to OpenAI, Anthropic, and Cursor APIs
- **Sandbox-free macOS app** — required to read local credential stores and call provider APIs; see [SECURITY.md](SECURITY.md)

## Requirements

- macOS 14+ Sonoma
- Xcode 15+ only if building from source

Node.js is not required to install or run the macOS app.

## Install

Download the latest DMG from [GitHub Releases](https://github.com/aalksii/creditwatcher/releases/latest), open it, and drag **CreditWatcher** to **Applications**.

Launch **CreditWatcher**. A gauge icon appears in the menu bar with no Dock icon.

## Usage

1. Click the menu bar gauge icon.
2. Open Settings with the gear button.
3. Use **Sign In** for each provider you want to monitor.
4. Return to the usage view and click **Refresh**.

The menu bar icon reflects worst-case usage:

- system default below 70%
- yellow from 70-90%
- red above 90%

Use Settings to show/hide providers, reorder cards, and sign providers out.

## Provider Setup

### Codex

Click **Sign In** in CreditWatcher Settings. The app opens the browser for Codex OAuth, listens for the local callback, and saves tokens to `~/.creditwatcher/auth.json`.

If you already use the official Codex tool, CreditWatcher can also read `~/.codex/auth.json`.

### Claude Code

Click **Sign In** in CreditWatcher Settings. If Claude Code stores credentials in Keychain, CreditWatcher first shows a one-time explanation and then macOS asks for permission. Choose **Continue** only if you want to connect Claude.

The app imports available Claude Code credentials from:

1. `CLAUDE_CODE_OAUTH_TOKEN`
2. `~/.claude/.credentials.json`
3. macOS Keychain entries used by Claude Code
4. `~/.creditwatcher/claude-auth.json`

After Claude is connected, CreditWatcher refreshes the Claude access token automatically using the saved refresh token. If the copied token expires, the app can also fall back to Claude Code's Keychain item without showing another prompt, as long as macOS has already allowed access.

If no Claude credentials exist yet, sign in to Claude Code once, then click **Sign In** again. CreditWatcher does not automate a fresh Claude web login, does not collect your Claude password, and does not bypass macOS Keychain permission. If the Claude Code session itself expires or Anthropic rejects the refresh token, sign in to Claude Code again and reconnect Claude from Settings. If you choose **Skip Claude**, the Claude provider is hidden and CreditWatcher will not keep asking.

### Cursor

Sign in to Cursor.app, then click **Sign In** or **Refresh** in CreditWatcher.

CreditWatcher reads Cursor's local SQLite state database at:

`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`

## Build From Source

Open the Xcode project:

```bash
open macos/CreditWatcher.xcodeproj
```

Then run the **CreditWatcher** scheme.

Or build from the command line:

```bash
xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build
```

Build a local DMG:

```bash
scripts/build-dmg.sh
```

The DMG is written to `dist/macos/CreditWatcher-<version>.dmg`.

For a clean local reinstall test:

```bash
scripts/uninstall-local.sh --dry-run
scripts/uninstall-local.sh
scripts/build-dmg.sh
```

`scripts/uninstall-local.sh` removes `/Applications/CreditWatcher.app` and legacy CreditWatcher-owned CLI shims from earlier builds. It keeps `~/.creditwatcher` unless you pass `--cache`.

For public distribution, sign and notarize it with an Apple Developer ID:

```bash
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="notarytool-profile" \
scripts/build-dmg.sh
```

Create the `notarytool` profile once with `xcrun notarytool store-credentials`.

## Troubleshooting Reinstall

If the app behaves strangely after upgrading from an older build, do a clean reinstall:

```bash
scripts/uninstall-local.sh --dry-run
scripts/uninstall-local.sh
scripts/build-dmg.sh
```

Then open `dist/macos/CreditWatcher-0.2.0.dmg` and drag **CreditWatcher** to **Applications**.

By default, the uninstall script removes `/Applications/CreditWatcher.app` and old CreditWatcher-owned terminal shims, but keeps `~/.creditwatcher` so existing auth/cache copies survive. To reset all local CreditWatcher data and app preferences too:

```bash
scripts/uninstall-local.sh --cache
scripts/build-dmg.sh
```

After a full reset, reconnect providers from Settings. Codex signs in through the browser, Claude can import from Claude Code/Keychain again, and Cursor reconnects from Cursor.app local state.

## Architecture

```text
CreditWatcher.app
├── SwiftUI/AppKit menu bar UI
├── Native provider auth/import
├── CodexProvider
├── ClaudeProvider
└── CursorProvider
        │
        └── local cache: ~/.creditwatcher/
```

The native app calls provider APIs directly via `URLSession`.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CODEX_HOME` | `~/.codex` | Existing Codex auth directory |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude credentials directory |
| `CLAUDE_CODE_OAUTH_TOKEN` | - | Claude OAuth token override |
| `CURSOR_SESSION_TOKEN` | - | Cursor session cookie value |
| `CURSOR_STATE_DB` | platform default | Override path to Cursor `state.vscdb` |
