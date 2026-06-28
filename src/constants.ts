/**
 * OAuth constants matching the official Codex CLI (public client_id).
 * Source: openai/codex-rs and openresponses/codex/oauth.go
 */
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OAUTH_ISSUER = "https://auth.openai.com";
export const OAUTH_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
export const OAUTH_REDIRECT_PORT = 1455;
export const OAUTH_REDIRECT_PATH = "/auth/callback";

export const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const USER_AGENT = "creditwatcher/0.1.0";

/** Minimum seconds between usage API calls (on-demand only). */
export const USAGE_MIN_INTERVAL_SEC = 60;

export const DISCLAIMER = `
⚠️  Safety notice: creditwatcher only reads your usage limits via GET /wham/usage.
   Tokens stay on your machine. No inference proxying. Use at your own risk.
   Prefer logging in with the official \`codex login\` and reading ~/.codex/auth.json.
`.trim();
