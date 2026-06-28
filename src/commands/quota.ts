import { getQuota } from "../server/quota.js";
import type { ProviderQuota, QuotaResponse } from "../server/quota.js";

export interface QuotaCommandOptions {
  force?: boolean;
  json?: boolean;
}

export interface QuotaJsonProvider {
  id: string;
  status: ProviderQuota["status"];
  plan?: string;
  account?: string;
  windows: ProviderQuota["windows"];
  credits?: ProviderQuota["credits"];
  warnings: string[];
  error?: string;
  loginHint?: string;
  cached?: boolean;
  secondsUntilRefresh?: number;
  nextRefreshAt?: string;
  lastUpdated?: string;
}

export interface QuotaJsonResponse {
  providers: QuotaJsonProvider[];
  updatedAt: string;
}

function toJsonResponse(quota: QuotaResponse): QuotaJsonResponse {
  const providers: QuotaJsonProvider[] = [
    quota.codex,
    quota.claude,
    quota.cursor,
  ].map((p) => ({
    id: p.provider,
    status: p.status,
    plan: p.plan,
    account: p.account,
    windows: p.windows,
    credits: p.credits,
    warnings: p.warnings,
    error: p.error,
    loginHint: p.loginHint,
    cached: p.cached,
    secondsUntilRefresh: p.secondsUntilRefresh,
    nextRefreshAt: p.nextRefreshAt,
    lastUpdated: p.lastUpdated,
  }));

  return {
    providers,
    updatedAt: quota.fetchedAt,
  };
}

export async function quotaCommand(
  options: QuotaCommandOptions = {},
): Promise<void> {
  const quota = await getQuota({ force: options.force });

  if (options.json) {
    console.log(JSON.stringify(toJsonResponse(quota), null, 2));
    return;
  }

  console.log(JSON.stringify(toJsonResponse(quota)));
}
