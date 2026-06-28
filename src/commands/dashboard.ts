import { renderDashboard } from "../dashboard/terminal.js";
import type { DisplayOptions } from "../display-options.js";
import {
  loadProviderAuthToken,
  TOKEN_WARNING,
} from "../display-options.js";
import { getQuota } from "../server/quota.js";
import type { QuotaProvider } from "../server/quota-cache.js";

export interface DashboardCommandOptions extends DisplayOptions {
  force?: boolean;
}

async function loadAuthTokens(
  showToken: boolean,
): Promise<Partial<Record<QuotaProvider, string>>> {
  if (!showToken) return {};

  const providers: QuotaProvider[] = ["codex", "claude", "cursor"];
  const entries = await Promise.all(
    providers.map(async (provider) => {
      const token = await loadProviderAuthToken(provider);
      return token ? ([provider, token] as const) : null;
    }),
  );

  return Object.fromEntries(
    entries.filter((entry): entry is [QuotaProvider, string] => entry != null),
  );
}

export async function dashboardCommand(
  options: DashboardCommandOptions = {},
): Promise<void> {
  if (options.showToken) {
    console.error(TOKEN_WARNING);
  }

  const quota = await getQuota({ force: options.force });
  const authTokens = await loadAuthTokens(options.showToken === true);
  console.log(
    renderDashboard(quota, {
      verbose: options.verbose,
      showToken: options.showToken,
      authTokens,
    }),
  );

  const anyConnected =
    quota.codex.status !== "not_connected" ||
    quota.claude.status !== "not_connected" ||
    quota.cursor.status !== "not_connected";

  if (!anyConnected) {
    process.exitCode = 1;
  }
}
