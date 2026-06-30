# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub issue.

Instead, use [GitHub Security Advisories](https://github.com/aalksii/creditwatcher/security/advisories/new) (preferred) or contact the repository owner privately.

Include:

- A description of the issue and potential impact
- Steps to reproduce
- Affected versions or commits

We aim to acknowledge reports within a reasonable timeframe.

## Scope

CreditWatcher is a local-only usage monitor. It is **not** a hosted service.

### What the app does

- Reads OAuth/session tokens from **local** stores only:
  - Codex CLI auth (`~/.codex/auth.json` or `~/.creditwatcher/auth.json`)
  - Claude Code credentials file or `~/.creditwatcher/claude-auth.json` (menu bar app never reads macOS Keychain)
  - Cursor IDE SQLite state database
- Calls **official provider APIs** directly for read-only usage data:
  - OpenAI / Codex (`chatgpt.com`, `auth.openai.com`)
  - Anthropic (`api.anthropic.com`, `platform.claude.com`)
  - Cursor (`cursor.com`)
- Caches quota responses locally under `~/.creditwatcher/`

### What the app does not do

- No telemetry or analytics
- No third-party relay servers
- No inference proxying
- Tokens are never logged to stdout/stderr in normal operation

### Out of scope

Issues in third-party services (OpenAI, Anthropic, Cursor), official CLI tools, or misuse of exported tokens are generally outside this project's security scope.
