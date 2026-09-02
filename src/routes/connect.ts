/**
 * Instagram OAuth connect flow.
 *
 * Security notes, since this is the step that hands us an access token:
 *
 *   - `state` is signed and bound to the session. Without it an attacker can
 *     complete a flow with their own authorisation code and silently attach
 *     THEIR Instagram account to the operator's instance, harvesting every DM
 *     the operator's automations would have sent.
 *   - `state` also carries a short expiry, so a leaked authorise URL is not
 *     usable indefinitely.
 *   - The token is exchanged for a long-lived one and encrypted before it
 *     reaches the database.
 *   - The authorisation code is never logged.
 */

import type { Env } from "../env";
import { html } from "../lib/html";
import { layout } from "../lib/ui";
import { sign, verifySigned, encryptToken, randomId, toB64url, fromB64url } from "../lib/crypto";
import { getAccountByIgId, countAccounts } from "../lib/db";
import { loadConfig, licenceKey } from "../lib/config";
import { verifyLicence, canConnectAnotherAccount } from "../lib/license";
import {
  authorizeUrl,
  exchangeCode,
  exchangeForLongLived,
  getProfile,
} from "../lib/instagram";
import type { Session } from "../lib/session";

const STATE_TTL_SECONDS = 600;

function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/connect/callback`;
}

async function makeState(session: Session, secret: string): Promise<string> {
  const payload = toB64url(
    new TextEncoder().encode(
      JSON.stringify({
        csrf: session.csrf,
        nonce: randomId(8),
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
      }),
    ),
  );
  return `${payload}.${await sign(payload, secret)}`;
}

async function checkState(
  state: string,
  session: Session,
  secret: string,
): Promise<boolean> {
  const separator = state.lastIndexOf(".");
  if (separator === -1) return false;

  const payload = state.slice(0, separator);
  if (!(await verifySigned(payload, state.slice(separator + 1), secret))) return false;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      csrf: string;
      exp: number;
    };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return false;
    return parsed.csrf === session.csrf;
  } catch {
    return false;
  }
}

export async function startConnect(
  env: Env,
  request: Request,
  session: Session,
  nonce: string,
): Promise<Response> {
  const config = await loadConfig(env, request);
  if (!config.appId || !config.appSecret) {
    // Bouncing silently back to the wizard looks like a dead button. Say which
    // half is missing — the operator cannot guess, and neither could we.
    console.error(
      `[connect] cannot start: appId=${config.appId ? "present" : "MISSING"} ` +
        `appSecret=${config.appSecret ? "present" : "MISSING"}`,
    );
    return renderMessage(
      nonce,
      "Meta app details are missing",
      config.appId
        ? "Your Meta app secret could not be read. This usually means TOKEN_ENCRYPTION_KEY changed after the secret was saved. Re-enter your app secret in Settings to fix it."
        : "Your Meta app ID has not been saved yet. Finish step 2 of setup first.",
    );
  }

  // Licence gate at connect time rather than per send. The realistic leak is
  // one agency running one licence across many client accounts, and this is
  // where that becomes a clear, provable breach instead of an argument.
  const key = await licenceKey(env);
  if (key) {
    const licence = await verifyLicence(key);
    const connected = await countAccounts(env);
    if (!canConnectAnotherAccount(licence, connected)) {
      return renderMessage(
        nonce,
        "Account limit reached",
        `Your licence covers ${licence.accountLimit} Instagram account${
          licence.accountLimit === 1 ? "" : "s"
        }. Upgrade to connect more.`,
      );
    }
  }

  const state = await makeState(session, env.SESSION_SECRET);
  return Response.redirect(authorizeUrl(config, redirectUri(request), state), 302);
}

export async function finishConnect(
  env: Env,
  request: Request,
  session: Session,
  nonce: string,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    return renderMessage(
      nonce,
      "Instagram declined",
      "The connection was cancelled or refused. You can try again from Settings.",
    );
  }

  if (!code || !state || !(await checkState(state, session, env.SESSION_SECRET))) {
    // Vague on purpose: a precise message helps someone probing the flow.
    return renderMessage(
      nonce,
      "Could not complete connection",
      "The connection link was invalid or expired. Start again from Settings.",
    );
  }

  const config = await loadConfig(env, request);

  try {
    const short = await exchangeCode(config, code, redirectUri(request));
    const long = await exchangeForLongLived(config, short.access_token);
    const profile = await getProfile(config, long.access_token);

    const cipher = await encryptToken(long.access_token, env.TOKEN_ENCRYPTION_KEY);
    const expiresAt = Math.floor(Date.now() / 1000) + (long.expires_in ?? 5_184_000);
    const existing = await getAccountByIgId(env, profile.user_id);

    if (existing) {
      await env.DB.prepare(
        `UPDATE accounts
            SET token_cipher = ?, token_expires = ?, username = ?, health = 'OK', health_note = NULL
          WHERE id = ?`,
      )
        .bind(cipher, expiresAt, profile.username, existing.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO accounts (id, ig_user_id, username, token_cipher, token_expires)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(randomId(12), profile.user_id, profile.username, cipher, expiresAt)
        .run();
    }

    return Response.redirect(new URL("/?connected=1", request.url).toString(), 302);
  } catch (error) {
    // The message may contain platform detail but never the code or token.
    const detail = error instanceof Error ? error.message : "Unknown error";
    return renderMessage(
      nonce,
      "Instagram rejected the connection",
      `${detail}. Check that your Redirect URI in Meta exactly matches ${redirectUri(request)}, and that the account is a Business or Creator account.`,
    );
  }
}

function renderMessage(nonce: string, title: string, message: string): Response {
  const page = layout(
    { title, nonce, session: true },
    html`<div class="card mt-24">
      <h3 class="mt-0">${title}</h3>
      <p class="small muted">${message}</p>
      <p><a class="btn secondary" href="/settings">Back to settings</a></p>
    </div>`,
  );
  return new Response(page, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
