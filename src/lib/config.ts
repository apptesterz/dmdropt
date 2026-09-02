/**
 * Runtime configuration.
 *
 * Only two values must exist before the app can boot — SESSION_SECRET and
 * TOKEN_ENCRYPTION_KEY — and both are set once at deploy time.
 *
 * Everything else (Meta app id, app secret, webhook verify token, admin
 * password) is collected through the setup wizard and stored in the database,
 * because the buyer is a non-technical creator who cannot run
 * `wrangler secret put`. Requiring a CLI for setup would put the entire
 * business behind a terminal.
 *
 * The Meta app secret is encrypted at rest with the same authenticated cipher
 * as platform tokens. Environment variables still win when present, so a
 * technical operator can configure everything without touching the wizard.
 */

import type { Env } from "../env";
import { getSetting, setSetting } from "./db";
import { encryptToken, decryptToken } from "./crypto";

export interface AppConfig {
  appId: string;
  appSecret: string;
  webhookVerifyToken: string;
  graphVersion: string;
  origin: string;
}

export const SETTING = {
  appId: "ig_app_id",
  appSecret: "ig_app_secret_enc",
  verifyToken: "ig_webhook_verify_token",
  passwordHash: "admin_password_hash",
  licenceKey: "licence_key",
  origin: "public_origin",
  setupStep: "setup_step",
  instanceId: "instance_id",
  /** "own" (their Meta app) or "dmdrop" (the broker). Absent means own. */
  connectMode: "connect_mode",
  brokerInstanceId: "broker_instance_id",
  brokerSecret: "broker_shared_secret",
  /** One-shot nonce, checked when the broker hands the token back. */
  brokerState: "broker_state",
} as const;

export async function loadConfig(env: Env, request?: Request): Promise<AppConfig> {
  const [appId, encryptedSecret, verifyToken, storedOrigin] = await Promise.all([
    getSetting(env, SETTING.appId),
    getSetting(env, SETTING.appSecret),
    getSetting(env, SETTING.verifyToken),
    getSetting(env, SETTING.origin),
  ]);

  let appSecret = env.IG_APP_SECRET ?? "";
  if (!appSecret && encryptedSecret) {
    try {
      appSecret = await decryptToken(encryptedSecret, env.TOKEN_ENCRYPTION_KEY);
    } catch (error) {
      // A secret that will not decrypt means TOKEN_ENCRYPTION_KEY changed since
      // it was stored. Treat it as absent so setup can re-collect it, rather
      // than failing every request with an opaque crypto error.
      //
      // LOUDLY, though: silently blanking it makes the symptom ("Connect
      // Instagram does nothing") impossible to trace back to the cause.
      console.error(
        "[config] stored Meta app secret could not be decrypted — " +
          "TOKEN_ENCRYPTION_KEY does not match the one used to store it: " +
          (error instanceof Error ? error.message : String(error)),
      );
      appSecret = "";
    }
  }

  return {
    appId: env.IG_APP_ID || appId || "",
    appSecret,
    webhookVerifyToken: env.IG_WEBHOOK_VERIFY_TOKEN || verifyToken || "",
    graphVersion: env.IG_GRAPH_VERSION || "v25.0",
    origin: storedOrigin || (request ? new URL(request.url).origin : ""),
  };
}

export async function saveMetaCredentials(
  env: Env,
  appId: string,
  appSecret: string,
  verifyToken: string,
): Promise<void> {
  await setSetting(env, SETTING.appId, appId);
  await setSetting(env, SETTING.appSecret, await encryptToken(appSecret, env.TOKEN_ENCRYPTION_KEY));
  await setSetting(env, SETTING.verifyToken, verifyToken);
}

export async function adminPasswordHash(env: Env): Promise<string | null> {
  return env.ADMIN_PASSWORD_HASH || (await getSetting(env, SETTING.passwordHash));
}

export async function licenceKey(env: Env): Promise<string | null> {
  return env.LICENCE_KEY || (await getSetting(env, SETTING.licenceKey));
}

export interface SetupState {
  passwordSet: boolean;
  metaConfigured: boolean;
  accountConnected: boolean;
  complete: boolean;
}

export async function setupState(env: Env): Promise<SetupState> {
  const [hash, config, accounts, mode] = await Promise.all([
    adminPasswordHash(env),
    loadConfig(env),
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>(),
    getSetting(env, SETTING.connectMode),
  ]);

  const passwordSet = Boolean(hash);

  // On the easy-connect path this instance holds no app credentials at all —
  // the broker owns them, because the token exchange needs the app secret.
  // Without this the gate would demand an app id that will never exist and
  // trap the customer in the wizard with no way out.
  const metaConfigured =
    mode === "dmdrop" ||
    Boolean(config.appId && config.appSecret && config.webhookVerifyToken);
  const accountConnected = (accounts?.n ?? 0) > 0;

  return {
    passwordSet,
    metaConfigured,
    accountConnected,
    complete: passwordSet && metaConfigured && accountConnected,
  };
}

/**
 * The webhook verify token, created once and then reused.
 *
 * It MUST be stable: the operator pastes it into Meta, and Meta immediately
 * calls back to compare it against what we hold. Regenerating it on each page
 * render — as an earlier version did — meant a reload silently invalidated the
 * value already pasted into Meta, producing a verification failure with no
 * visible cause.
 */
export async function ensureVerifyToken(env: Env): Promise<string> {
  const existing = await getSetting(env, SETTING.verifyToken);
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  await setSetting(env, SETTING.verifyToken, token);
  return token;
}

/** Stable per-instance identifier for the activation ping. Not personal data. */
export async function instanceId(env: Env): Promise<string> {
  const existing = await getSetting(env, SETTING.instanceId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setSetting(env, SETTING.instanceId, id);
  return id;
}
