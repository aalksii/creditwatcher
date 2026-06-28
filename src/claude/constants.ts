export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
/** Match a recent Claude Code release for usage checks only. */
export const CLAUDE_USER_AGENT = "claude-code/2.1.195";

export const CLAUDE_DISCLAIMER = `
⚠️  Safety notice: creditwatcher only reads Claude usage via GET /api/oauth/usage.
   Tokens stay on your machine. No inference proxying. Use at your own risk.
   Prefer logging in with the official \`claude\` CLI and reading ~/.claude/.credentials.json.
`.trim();
