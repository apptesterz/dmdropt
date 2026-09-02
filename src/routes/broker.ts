/**
 * The easy-connect path, instance side.
 *
 * A customer may connect Instagram two ways. With their own Meta app — the
 * default, twenty minutes of console work, and afterwards nothing of ours sits
 * in the path. Or with dmdrop's app, which is one tap, and routes their
 * incoming webhooks through our broker.
 *
 * What changes in broker mode is narrow, and worth stating precisely:
 *
 *   - the token EXCHANGE happens at the broker, because it needs the app secret
 *   - incoming webhooks arrive relayed rather than direct
 *
 * What does not change: the token is stored here, encrypted with a key the
 * broker never sees. Every message is sent from here using that token. The
 * daily refresh runs here, and needs no app secret. So an instance in broker
 * mode is still doing all of its own work — it is only being told when
 * something happened.
 *
 * That asymmetry is what keeps the ownership promise real. If the broker goes
 * away, this instance keeps its data, its automations and its token, and
 * switching to an own Meta app restores incoming events.
 */

import type { Env } from "../env";
import { randomId, encryptToken, timingSafeEqual, hmacHex } from "../lib/crypto";
import { getSetting, setSetting, getAccountByIgId, setAccountHealth } from "../lib/db";
import { SETTING, licenceKey, setupState } from "../lib/config";

/** Where the broker lives. Overridable so a self-hoster can run their own. */
export function brokerUrl(env: Env): string {
  return (env.BROKER_URL || "https://connect.dmdrop.in").replace(/\/+$/, "");
}

export async function connectMode(env: Env): Promise<"own" | "dmdrop"> {
  return (await getSetting(env, SETTING.connectMode)) === "dmdrop" ? "dmdrop" : "own";
}

/**
 * Why a broker connect attempt stopped, phrased for the person who pressed it.
 *
 * These used to be silent: the handler redirected with `?connect=<reason>` and
 * nothing anywhere read that parameter, so all three failures looked identical
 * to a page that reloaded and did nothing. On a fresh install the reason is
 * always `nolicence`, which meant the very first thing a new customer touched
 * appeared to be broken.
 */
const CONNECT_ERROR: Record<string, string> = {
  nolicence:
    "Enter your licence key below first — the one-tap connection uses it to prove this copy was paid for.",
  refused:
    "The dmdrop relay would not accept that licence key. Check it, or connect with your own Meta app instead.",
  unreachable:
    "Could not reach the dmdrop relay just now. Try again in a moment, or connect with your own Meta app.",
  // Reported by the broker after Instagram has had its turn.
  cancelled: "Instagram sign-in was cancelled. Nothing changed — press Connect again when you are ready.",
  failed:
    "Instagram approved the connection but the token could not be collected. Try once more; if it keeps happening, connect with your own Meta app.",
  expired: "That connect link had gone stale. Press Connect again to start a fresh one.",
};

export function connectError(request: Request): string {
  return CONNECT_ERROR[new URL(request.url).searchParams.get("connect") ?? ""] ?? "";
}

/**
 * Send the browser back to a page it is actually allowed to see.
 *
 * /settings sits behind the setup gate, so during first-run setup a redirect
 * there is bounced to /setup and the query string is dropped on the way. That
 * is the second half of the same silent failure.
 */
async function connectFailed(env: Env, origin: string, reason: string): Promise<Response> {
  const where = (await setupState(env)).complete ? "settings" : "setup";
  return Response.redirect(`${origin}/${where}?connect=${reason}`, 302);
}

/**
 * Ask the broker for an identity, then send the browser to it.
 *
 * Registration is server to server and carries the licence key, which is the
 * credential. The browser only ever sees an opaque instance id and a nonce.
 */
export async function startBrokerConnect(env: Env, request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const key = (await licenceKey(env)) ?? "";

  if (!key) {
    return connectFailed(env, origin, "nolicence");
  }

  let registration: { instance_id?: string; shared_secret?: string; error?: string };
  try {
    const response = await fetch(`${brokerUrl(env)}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_url: origin, licence_key: key }),
      signal: AbortSignal.timeout(15_000),
    });
    registration = (await response.json()) as typeof registration;
    if (!response.ok || !registration.instance_id || !registration.shared_secret) {
      console.error("[broker] registration refused", response.status, registration.error);
      return connectFailed(env, origin, "refused");
    }
  } catch (error) {
    console.error("[broker] registration failed", error);
    return connectFailed(env, origin, "unreachable");
  }

  // A fresh nonce per attempt, checked when the token comes back. Without it a
  // stale or replayed handover could attach an account this instance never
  // asked for.
  const state = randomId(16);
  await setSetting(env, SETTING.brokerInstanceId, registration.instance_id);
  await setSetting(env, SETTING.brokerSecret, registration.shared_secret);
  await setSetting(env, SETTING.brokerState, state);

  const start = new URL(`${brokerUrl(env)}/connect/start`);
  start.searchParams.set("i", registration.instance_id);
  start.searchParams.set("s", state);
  return Response.redirect(start.toString(), 302);
}

/**
 * Verify that a request really came from the broker.
 *
 * In own-app mode the instance checks Meta's `x-hub-signature-256` using the
 * app secret. In broker mode it holds no app secret, so it cannot — this is the
 * replacement, and it is the only thing standing between a public endpoint and
 * anyone who learns this instance's URL being able to inject fabricated
 * comments, or hand it an attacker-controlled access token.
 */
async function verifyBroker(env: Env, rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const secret = await getSetting(env, SETTING.brokerSecret);
  if (!secret) return false;
  return timingSafeEqual(header.slice(7).toLowerCase(), await hmacHex(rawBody, secret));
}

interface Handover {
  state?: string;
  access_token?: string;
  expires_in?: number;
  ig_user_id?: string;
  username?: string | null;
}

/** The broker POSTs the token here once Instagram has authorised it. */
export async function receiveBrokerToken(env: Env, request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 32_000) return new Response("Too large", { status: 413 });

  if (!(await verifyBroker(env, raw, request.headers.get("x-dmdrop-signature")))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: Handover;
  try {
    body = JSON.parse(raw) as Handover;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // The nonce this instance generated when it started the flow. A handover that
  // does not carry it is one we did not ask for.
  const expected = await getSetting(env, SETTING.brokerState);
  if (!expected || !body.state || !timingSafeEqual(body.state, expected)) {
    return new Response("Unexpected handover", { status: 409 });
  }
  await setSetting(env, SETTING.brokerState, "");

  if (!body.access_token || !body.ig_user_id) {
    return new Response("Incomplete", { status: 400 });
  }

  const cipher = await encryptToken(body.access_token, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = Math.floor(Date.now() / 1000) + (body.expires_in ?? 5_184_000);
  const existing = await getAccountByIgId(env, body.ig_user_id);

  if (existing) {
    await env.DB.prepare(
      `UPDATE accounts
          SET token_cipher = ?, token_expires = ?, username = ?, health = 'OK', health_note = NULL
        WHERE id = ?`,
    )
      .bind(cipher, expiresAt, body.username ?? existing.username, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO accounts (id, ig_user_id, username, token_cipher, token_expires)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(randomId(12), body.ig_user_id, body.username ?? body.ig_user_id, cipher, expiresAt)
      .run();
  }

  await setSetting(env, SETTING.connectMode, "dmdrop");
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A webhook relayed by the broker.
 *
 * The body is Meta's payload verbatim, so it is handed to exactly the same
 * processing as a direct webhook. One code path for events regardless of how
 * the account was connected — the alternative is two subtly diverging
 * implementations of the most important logic in the product.
 */
export async function receiveRelayedWebhook(
  env: Env,
  request: Request,
  process: (raw: string) => Promise<void>,
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 512_000) return new Response("Payload too large", { status: 413 });

  if (!(await verifyBroker(env, raw, request.headers.get("x-dmdrop-signature")))) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    await process(raw);
  } catch (error) {
    // Acknowledge regardless. A non-200 makes the broker look failed to Meta,
    // which would earn a re-delivery of a payload already recorded here.
    console.error("[broker] relayed processing failed", error);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Go back to an own Meta app.
 *
 * Clears only the broker's identity and the mode. Automations, contacts, click
 * history and the delivery log are untouched — this is the switch that makes
 * "you own it" a statement rather than a slogan, so it must never be the kind
 * of migration that loses data.
 */
export async function switchToOwnApp(env: Env): Promise<void> {
  await setSetting(env, SETTING.connectMode, "own");
  await setSetting(env, SETTING.brokerInstanceId, "");
  await setSetting(env, SETTING.brokerSecret, "");
  await setSetting(env, SETTING.brokerState, "");
}

/**
 * Meta told the broker this account is gone; the broker is telling us.
 *
 * On the relayed path Meta only knows about the broker, so its deauthorize and
 * data-deletion callbacks never reach this instance. Without this notice the
 * operator would keep a dead token and watch every send fail with no
 * explanation — the exact silent failure the health banner exists to prevent.
 *
 * The account is marked revoked rather than deleted. Deleting it would take the
 * automations and the delivery history with it, and a revocation is very often
 * an accidental tap that a reconnect fixes.
 */
export async function receiveRevocation(env: Env, request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 8_000) return new Response("Too large", { status: 413 });

  if (!(await verifyBroker(env, raw, request.headers.get("x-dmdrop-signature")))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: { ig_user_id?: string; reason?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (!body.ig_user_id) return new Response("Incomplete", { status: 400 });

  const account = await getAccountByIgId(env, body.ig_user_id);
  if (account) {
    await setAccountHealth(
      env,
      account.id,
      "PERMISSION_REVOKED",
      body.reason === "deleted"
        ? "This person requested deletion through Instagram. Reconnect to resume."
        : "Access was removed from Instagram. Reconnect to resume.",
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Where the broker sends the browser once Instagram is done.
 *
 * The broker cannot know whether this instance has finished its wizard, and it
 * guessed wrong: it redirected to /settings, which the setup gate bounces to
 * /setup, dropping the reason. So a first-time customer who had just approved
 * the app on Instagram was returned to the same wizard screen with nothing said
 * either way — success and failure looked identical, and identical to not
 * having pressed the button at all.
 *
 * One public landing route, and the instance decides for itself.
 */
export async function brokerConnectDone(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const reason = url.searchParams.get("connect") ?? "";
  const complete = (await setupState(env)).complete;

  // Anything the broker did not name is treated as success, because the only
  // way here without a reason is the happy path.
  if (!(reason in CONNECT_ERROR)) {
    return Response.redirect(`${url.origin}/${complete ? "?connected=1" : "setup"}`, 302);
  }
  return Response.redirect(
    `${url.origin}/${complete ? "settings" : "setup"}?connect=${encodeURIComponent(reason)}`,
    302,
  );
}
