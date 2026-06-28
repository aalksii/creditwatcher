import { OAUTH_CLIENT_ID, OAUTH_ISSUER } from "../constants.js";
import type { Credentials } from "../types.js";
import { jwtChatGptAccountId } from "../utils.js";

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<Credentials> {
  const res = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  let data: TokenResponse;
  try {
    data = JSON.parse(body) as TokenResponse;
  } catch {
    throw new Error("Token refresh returned invalid JSON");
  }

  if (!data.access_token) {
    throw new Error("Token refresh response missing access_token");
  }

  const idToken = data.id_token ?? "";
  const accountId = jwtChatGptAccountId(idToken) ?? "";

  return {
    idToken,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    accountId,
    lastRefresh: new Date(),
    sourcePath: "",
  };
}

export async function ensureFreshCredentials(
  creds: Credentials,
): Promise<Credentials> {
  const { isTokenExpired } = await import("../utils.js");
  if (!isTokenExpired(creds.accessToken)) {
    return creds;
  }

  const refreshed = await refreshAccessToken(creds.refreshToken);
  const merged: Credentials = {
    ...refreshed,
    accountId: refreshed.accountId || creds.accountId,
    idToken: refreshed.idToken || creds.idToken,
    sourcePath: creds.sourcePath,
  };

  const { saveCredentials } = await import("./storage.js");
  if (creds.sourcePath.includes(".creditwatcher")) {
    await saveCredentials(merged);
  }

  return merged;
}
