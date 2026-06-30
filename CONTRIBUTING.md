# Contributing to CreditWatcher

Thank you for your interest in contributing. This project includes a Node.js CLI and a native macOS menu bar app.

## Development setup

### CLI

```bash
git clone https://github.com/aalksii/creditwatcher.git
cd creditwatcher
npm install
npm run build
npm link   # optional — install `creditwatcher` on your PATH
```

Run without linking:

```bash
npm run dashboard
npm run status
```

### macOS menu bar app

Requirements: macOS 14+, Xcode 15+.

```bash
open macos/CreditWatcher.xcodeproj
# Product → Run (⌘R)
```

Or from the command line:

```bash
xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build
```

Sign in with the official Codex CLI, Claude Code, and/or Cursor.app before testing provider integrations.

## Pull requests

1. Open an issue first for large changes so we can align on approach.
2. Keep PRs focused — one logical change per PR when possible.
3. Verify locally before submitting:
   - `npm run build`
   - `xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build`
4. Do not commit secrets, tokens, or personal paths.
5. Update README if you change user-facing behavior or setup steps.

## Code style

- TypeScript: match existing patterns in `src/` (ES modules, strict mode).
- Swift: follow existing SwiftUI/AppKit conventions in `macos/CreditWatcher/`.
- Avoid adding dependencies unless they clearly reduce complexity.

## Security

If you discover a security issue, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
