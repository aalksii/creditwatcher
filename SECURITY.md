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
  - Codex local auth (`~/.codex/auth.json` or `~/.creditwatcher/auth.json`)
  - Claude Code credentials file, macOS Keychain entries used by Claude Code, or `~/.creditwatcher/claude-auth.json`
  - Cursor IDE SQLite state database
- Reads Claude Code Keychain entries only after the user chooses Claude **Sign In** and accepts the app's one-time Keychain notice. Later background refreshes use non-interactive Keychain reads, so they do not show surprise permission prompts.
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

Issues in third-party services (OpenAI, Anthropic, Cursor), official provider apps/tools, or misuse of exported tokens are generally outside this project's security scope.
