import type { RateLimiter } from "./do/rate-limiter";

export interface Env {
  DB: D1Database;
  SENDS: Queue<SendJob>;
  RATE: DurableObjectNamespace<RateLimiter>;

  // Secrets — `wrangler secret put NAME`. Never in wrangler.toml.
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  IG_APP_ID: string;
  IG_APP_SECRET: string;
  IG_WEBHOOK_VERIFY_TOKEN: string;
  ADMIN_PASSWORD_HASH?: string;
  LICENCE_KEY?: string;

  // Vars
  /** The easy-connect broker. Overridable so a self-hoster can run their own. */
  BROKER_URL?: string;
  IG_GRAPH_VERSION: string;
  IG_PRIVATE_REPLY_HOURLY_CAP: string;
  MONTHLY_SEND_CAP: string;
  ACTIVATION_ENDPOINT?: string;
  /** Per-buyer build stamp. Set when packaging a download; see tools/issue-licence.mjs. */
  BUILD_ID?: string;
}

export type SendJob =
  | { kind: "COMMENT_REPLY"; sendLogId: string; requeues?: number }
  | { kind: "FOLLOW_CHECK"; sendLogId: string }
  | { kind: "FOLLOW_UP"; sendLogId: string }
  | { kind: "EMAIL_CAPTURED"; sendLogId: string }
  | { kind: "EMAIL_ASK"; sendLogId: string };

/**
 * Fail fast and loudly on a missing secret rather than producing a confusing
 * downstream error. A misconfigured instance should say exactly what is
 * missing — every unclear failure here becomes a support message.
 */
export function requireSecret(env: Env, name: keyof Env): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing required secret: ${String(name)}. Set it with: wrangler secret put ${String(name)}`,
    );
  }
  return value;
}

export function isSetupComplete(env: Env): boolean {
  return Boolean(env.ADMIN_PASSWORD_HASH && env.IG_APP_ID && env.IG_APP_SECRET);
}
