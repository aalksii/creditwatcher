import {
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_REFRESH_SCOPE,
  CLAUDE_REFRESH_LEEWAY_SEC,
  CLAUDE_TOKEN_URL,
  CLAUDE_USER_AGENT,
} from "./constants.js";
import type { ClaudeCredentials } from "./storage.js";
import { saveClaudeCredentialsCopy } from "./storage.js";
import { isTokenExpired, jwtExpiration } from "../utils.js";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export class ClaudeAuthError extends Error {
  constructor(
    message: string,
    readonly code: "token_expired" | "session_expired" | "refresh_failed",
  ) {
    super(message);
    this.name = "ClaudeAuthError";
  }

  get allowsSourceFallback(): boolean {
    return this.code === "token_expired" || this.code === "session_expired";
  }
}

function tokenExpiryMs(creds: ClaudeCredentials): number | null {
  const jwtExp = jwtExpiration(creds.accessToken);
  if (jwtExp) return jwtExp.getTime();
  if (creds.expiresAt) return creds.expiresAt.getTime();
  return null;
}

export function claudeTokenNeedsRefresh(creds: ClaudeCredentials): boolean {
  if (isTokenExpired(creds.accessToken, CLAUDE_REFRESH_LEEWAY_SEC)) {
    return true;
  }

  const expiryMs = tokenExpiryMs(creds);
  if (expiryMs == null) return false;
  return Date.now() + CLAUDE_REFRESH_LEEWAY_SEC * 1000 >= expiryMs;
}

export async function refreshClaudeAccessToken(
  refreshToken: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date;
}> {
  if (!refreshToken) {
    throw new ClaudeAuthError(
      "Claude refresh token missing. Run `claude` to sign in again.",
      "session_expired",
    );
  }

  const res = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": CLAUDE_USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      scope: CLAUDE_OAUTH_REFRESH_SCOPE,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    const lower = body.toLowerCase();
    if (
      res.status === 401 ||
      res.status === 403 ||
      lower.includes("invalid_grant") ||
      lower.includes("invalid_token")
    ) {
      throw new ClaudeAuthError(
        "Claude session expired. Run `claude` to sign in again.",
        "session_expired",
      );
    }
    if (res.status === 429) {
      throw new ClaudeAuthError(
        "Claude token refresh rate limited. Wait a minute and retry, or run `claude` to refresh credentials.",
        "refresh_failed",
      );
    }
    throw new ClaudeAuthError(
      `Claude token refresh failed (${res.status}): ${body.slice(0, 200)}`,
      "refresh_failed",
    );
  }

  let data: TokenResponse;
  try {
    data = JSON.parse(body) as TokenResponse;
  } catch {
    throw new ClaudeAuthError(
      "Claude token refresh returned invalid JSON",
      "refresh_failed",
    );
  }

  if (!data.access_token) {
    throw new ClaudeAuthError(
      "Claude token refresh response missing access_token",
      "refresh_failed",
    );
  }

  const expiresAt =
    data.expires_in != null
      ? new Date(Date.now() + data.expires_in * 1000)
      : jwtExpiration(data.access_token) ?? undefined;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt,
  };
}

export async function ensureFreshClaudeCredentials(
  creds: ClaudeCredentials,
): Promise<ClaudeCredentials> {
  if (!claudeTokenNeedsRefresh(creds)) {
    return creds;
  }

  const refreshed = await refreshClaudeAccessToken(creds.refreshToken);
  const merged: ClaudeCredentials = {
    ...creds,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt ?? creds.expiresAt,
  };

  if (!creds.managedByClaudeCode) {
    await saveClaudeCredentialsCopy(merged);
    merged.sourcePath = merged.sourcePath.includes(".creditwatcher")
      ? merged.sourcePath
      : creds.sourcePath;
  } else {
    const saved = await saveClaudeCredentialsCopy(merged);
    merged.sourcePath = saved.sourcePath;
    merged.managedByClaudeCode = false;
  }

  return merged;
}
