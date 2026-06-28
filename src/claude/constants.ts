export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
/** Scopes required for /api/oauth/usage (needs user:profile, not just user:inference). */
export const CLAUDE_OAUTH_REFRESH_SCOPE =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
/** Match a recent Claude Code release for usage checks only. */
export const CLAUDE_USER_AGENT = "claude-code/2.1.195";
/** Refresh access tokens this many seconds before JWT or expiresAt expiry. */
export const CLAUDE_REFRESH_LEEWAY_SEC = 300;

export const CLAUDE_DISCLAIMER = `
⚠️  Safety notice: creditwatcher only reads Claude usage via GET /api/oauth/usage.
   Tokens stay on your machine. No inference proxying. Use at your own risk.
   Prefer logging in with the official \`claude\` CLI and reading ~/.claude/.credentials.json.
`.trim();
