import { createServer, type Server } from "node:http";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  OAUTH_CLIENT_ID,
  OAUTH_ISSUER,
  OAUTH_REDIRECT_PATH,
  OAUTH_REDIRECT_PORT,
  OAUTH_SCOPE,
  USER_AGENT,
} from "../constants.js";
import type { Credentials } from "../types.js";
import {
  generatePkcePair,
  generateState,
  jwtChatGptAccountId,
} from "../utils.js";

const execAsync = promisify(exec);
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function buildAuthorizeUrl(
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "creditwatcher",
  });
  return `${OAUTH_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<Credentials> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: form.toString(),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = JSON.parse(body) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
  };

  if (!data.access_token || !data.refresh_token) {
    throw new Error("Token response missing required tokens");
  }

  const idToken = data.id_token ?? "";
  const accountId = jwtChatGptAccountId(idToken) ?? "";

  return {
    idToken,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId,
    lastRefresh: new Date(),
    sourcePath: "",
  };
}

function callbackHtml(success: boolean, detail = ""): string {
  if (success) {
    return `<!DOCTYPE html><html><body><h2>Signed in</h2><p>You can close this tab and return to the terminal.</p></body></html>`;
  }
  const escaped = detail.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
  return `<!DOCTYPE html><html><body><h2>Login failed</h2><p>${escaped}</p><p>Close this tab and try again in the terminal.</p></body></html>`;
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execAsync(`open "${url}"`);
    } else if (platform === "win32") {
      await execAsync(`start "" "${url}"`, { shell: "cmd.exe" });
    } else {
      await execAsync(`xdg-open "${url}"`);
    }
  } catch {
    console.log("\nCould not open browser automatically. Open this URL:\n");
    console.log(url);
  }
}

function awaitCallback(
  expectedState: string,
  port: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const servers: Server[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of servers) s.close();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("OAuth login timed out after 5 minutes")));
    }, LOGIN_TIMEOUT_MS);

    const handler = (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== OAUTH_REDIRECT_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(callbackHtml(false, desc));
        finish(() => reject(new Error(`OAuth error: ${desc}`)));
        return;
      }

      if (url.searchParams.get("state") !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(callbackHtml(false, "state mismatch"));
        finish(() => reject(new Error("OAuth state mismatch")));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(callbackHtml(false, "missing authorization code"));
        finish(() => reject(new Error("OAuth callback missing code")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(callbackHtml(true));
      finish(() => resolve(code));
    };

    const server = createServer(handler);
    servers.push(server);

    server.listen(port, "127.0.0.1", () => {
      // bound
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        finish(() =>
          reject(
            new Error(
              `Port ${port} is in use. Close other OAuth listeners or set CREDITWATCHER_OAUTH_PORT.`,
            ),
          ),
        );
      } else {
        finish(() => reject(err));
      }
    });
  });
}

export async function runOAuthLogin(): Promise<Credentials> {
  const port = Number(process.env.CREDITWATCHER_OAUTH_PORT ?? OAUTH_REDIRECT_PORT);
  const redirectUri = `http://localhost:${port}${OAUTH_REDIRECT_PATH}`;

  const { verifier, challenge } = generatePkcePair();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(redirectUri, challenge, state);

  console.log("Opening browser for Codex OAuth login...");
  console.log(`If the browser does not open, visit:\n${authorizeUrl}\n`);

  const callbackPromise = awaitCallback(state, port);
  await openBrowser(authorizeUrl);

  const code = await callbackPromise;
  return exchangeCode(code, verifier, redirectUri);
}
