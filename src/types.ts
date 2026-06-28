export interface AuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id?: string;
}

export interface AuthFile {
  tokens?: AuthTokens;
  last_refresh?: string;
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
}

export interface Credentials {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh?: Date;
  sourcePath: string;
}

export interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

export interface UsageResponse {
  plan_type?: string;
  email?: string;
  rate_limit?: {
    limit_reached?: boolean;
    primary_window?: RateLimitWindow;
    secondary_window?: RateLimitWindow | null;
  } | null;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
  spend_control?: { reached?: boolean };
}

export interface UsageSnapshot {
  planType: string;
  email?: string;
  limitReached: boolean;
  primary?: WindowSnapshot;
  secondary?: WindowSnapshot;
  credits?: {
    balance?: string;
    unlimited?: boolean;
    hasCredits?: boolean;
  };
  spendControlReached?: boolean;
}

export interface WindowSnapshot {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: Date;
  resetAfterSeconds?: number;
  windowSeconds?: number;
}
