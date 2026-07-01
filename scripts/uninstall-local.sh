#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${APP_PATH:-/Applications/CreditWatcher.app}"
DRY_RUN=0
REMOVE_CACHE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --cache|--with-cache)
      REMOVE_CACHE=1
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: npm run macos:uninstall -- [--dry-run] [--cache]" >&2
      exit 2
      ;;
  esac
done

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf 'Would run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

is_creditwatcher_cli_target() {
  local target="$1"
  [[ "$target" == *"/CreditWatcher.app/Contents/Resources/cli/creditwatcher" ]] ||
    [[ "$target" == *"/creditwatcher/dist/cli.js" ]]
}

remove_cli_shim() {
  local path="$1"

  if [[ -L "$path" ]]; then
    local target
    target="$(readlink "$path")"
    if is_creditwatcher_cli_target "$target"; then
      echo "Removing CLI shim: $path -> $target"
      run rm "$path"
    else
      echo "Leaving CLI shim in place: $path -> $target"
    fi
  elif [[ -e "$path" ]]; then
    echo "Leaving non-symlink command in place: $path"
  fi
}

echo "Quitting CreditWatcher if it is running..."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Would ask macOS to quit CreditWatcher"
else
  osascript -e 'quit app "CreditWatcher"' >/dev/null 2>&1 || true
fi

if [[ -d "$APP_PATH" ]]; then
  echo "Removing app: $APP_PATH"
  run rm -rf "$APP_PATH"
else
  echo "App not found: $APP_PATH"
fi

remove_cli_shim "/opt/homebrew/bin/creditwatcher"
remove_cli_shim "/usr/local/bin/creditwatcher"
remove_cli_shim "$HOME/.local/bin/creditwatcher"
remove_cli_shim "$HOME/bin/creditwatcher"

if [[ "$REMOVE_CACHE" -eq 1 ]]; then
  if [[ -d "$HOME/.creditwatcher" ]]; then
    echo "Removing local cache/auth copy: $HOME/.creditwatcher"
    run rm -rf "$HOME/.creditwatcher"
  else
    echo "Cache/auth copy not found: $HOME/.creditwatcher"
  fi
else
  echo "Keeping $HOME/.creditwatcher. Pass --cache to remove local cache/auth copies too."
fi

echo "Done."
