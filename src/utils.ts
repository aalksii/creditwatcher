import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkcePair(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function jwtExpiration(token: string): Date | null {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return new Date(payload.exp * 1000);
}

export function jwtChatGptAccountId(idToken: string): string | null {
  const payload = parseJwtPayload(idToken);
  if (!payload) return null;
  const claim =
    payload["https://api.openai.com/auth.chatgpt_account_id"] ??
    payload.chatgpt_account_id;
  return typeof claim === "string" ? claim : null;
}

export function isTokenExpired(token: string, leewaySec = 120): boolean {
  const exp = jwtExpiration(token);
  if (!exp) return false;
  return Date.now() + leewaySec * 1000 >= exp.getTime();
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && h === 0) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}

export function formatWindowLabel(seconds?: number): string {
  if (!seconds) return "window";
  if (seconds === 18000) return "5-hour";
  if (seconds === 604800) return "weekly";
  const hours = Math.round(seconds / 3600);
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}-day`;
  if (hours >= 1) return `${hours}-hour`;
  return `${Math.round(seconds / 60)}-min`;
}

export function progressBar(usedPercent: number, width = 12): string {
  const clamped = Math.min(Math.max(usedPercent, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
