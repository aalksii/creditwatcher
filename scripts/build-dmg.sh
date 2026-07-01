#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/macos/CreditWatcher.xcodeproj"
SCHEME="${SCHEME:-CreditWatcher}"
CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$ROOT_DIR/build/dmg-derived-data}"
STAGING_DIR="$ROOT_DIR/build/dmg-staging"
DIST_DIR="$ROOT_DIR/dist/macos"
APP_NAME="CreditWatcher"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/$APP_NAME.app"
VERSION="${VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
DMG_PATH="$DIST_DIR/$APP_NAME-$VERSION.dmg"

echo "Building bundled CLI..."
npm run build

echo "Building $APP_NAME.app ($CONFIGURATION)..."
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle was not produced: $APP_PATH" >&2
  exit 1
fi

CLI_RESOURCES="$APP_PATH/Contents/Resources/cli"
rm -rf "$CLI_RESOURCES"
mkdir -p "$CLI_RESOURCES"
ditto "$ROOT_DIR/dist" "$CLI_RESOURCES/dist"
cat > "$CLI_RESOURCES/creditwatcher" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "CreditWatcher CLI requires Node.js 18 or newer." >&2
  echo "Install Node.js, then run this command again." >&2
  exit 127
fi

exec node "$ROOT_DIR/dist/cli.js" "$@"
SH
chmod +x "$CLI_RESOURCES/creditwatcher"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$DIST_DIR"
ditto "$APP_PATH" "$STAGING_DIR/$APP_NAME.app"
ln -s /Applications "$STAGING_DIR/Applications"

if [[ -n "${SIGN_IDENTITY:-}" ]]; then
  echo "Signing $APP_NAME.app with: $SIGN_IDENTITY"
  codesign \
    --force \
    --deep \
    --timestamp \
    --options runtime \
    --entitlements "$ROOT_DIR/macos/CreditWatcher/CreditWatcher.entitlements" \
    --sign "$SIGN_IDENTITY" \
    "$STAGING_DIR/$APP_NAME.app"
fi

rm -f "$DMG_PATH"
echo "Creating $DMG_PATH..."
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  if [[ -z "${SIGN_IDENTITY:-}" ]]; then
    echo "NOTARY_PROFILE requires SIGN_IDENTITY so the app is signed before notarization." >&2
    exit 1
  fi

  echo "Submitting $DMG_PATH for notarization..."
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
fi

echo "Done: $DMG_PATH"
