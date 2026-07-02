# Contributing to CreditWatcher

Thank you for your interest in contributing. CreditWatcher is a native macOS menu bar app.

## Development setup

Requirements: macOS 14+, Xcode 15+.

```bash
open macos/CreditWatcher.xcodeproj
# Product → Run (⌘R)
```

Or from the command line:

```bash
xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build
```

Build a local DMG:

```bash
scripts/build-dmg.sh
```

Sign in to Codex from CreditWatcher Settings, Claude Code, and/or Cursor.app before testing provider integrations.

## Pull requests

1. Open an issue first for large changes so we can align on approach.
2. Keep PRs focused — one logical change per PR when possible.
3. Verify locally before submitting:
   - `xcodebuild -project macos/CreditWatcher.xcodeproj -scheme CreditWatcher -configuration Debug build`
   - `scripts/build-dmg.sh`
4. Do not commit secrets, tokens, or personal paths.
5. Update README if you change user-facing behavior or setup steps.

## Code style

- Swift: follow existing SwiftUI/AppKit conventions in `macos/CreditWatcher/`.
- Avoid adding dependencies unless they clearly reduce complexity.

## Security

If you discover a security issue, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
