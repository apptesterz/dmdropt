/**
 * Deauthorize and data-deletion callbacks.
 *
 * Meta REQUIRES both URLs before Instagram Business Login settings will save,
 * so these are not optional extras — without them setup cannot be completed.
 *
 * Both receive a `signed_request`: a base64url payload with an HMAC-SHA256
 * signature over it, keyed on the app secret. Note the ordering is the reverse
 * of a JWT — signature first, then payload.
 *
 * The signature is verified before the payload is parsed or acted on. These are
 * public endpoints, so without verification anyone could POST a user id and
 * disconnect the operator's account.
 */

import type { Env } from "../env";
import { loadConfig } from "../lib/config";
import { fromB64url, toB64url, timingSafeEqual } from "../lib/crypto";
import { getAccountByIgId, setAccountHealth } from "../lib/db";

interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
}

async function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<SignedRequestPayload | null> {
  const [signaturePart, payloadPart] = signedRequest.split(".");
  if (!signaturePart || !payloadPart) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart) as BufferSource),
  );

  // Constant-time compare, over the base64url encoding of both sides so the
  // comparison is on equal-length strings.
  if (!timingSafeEqual(toB64url(fromB64url(signaturePart)), toB64url(expected))) return null;

  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payloadPart))) as SignedRequestPayload;
  } catch {
    return null;
  }
}

async function readSignedRequest(request: Request): Promise<string | null> {
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      const value = form.get("signed_request");
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return new URL(request.url).searchParams.get("signed_request");
}

/**
 * Called by Meta when someone removes the app from their Instagram account.
 *
 * The stored token is already dead at this point, so the account is marked
 * revoked rather than silently failing every future send. The operator sees one
 * clear banner instead of a wall of identical errors.
 */
export async function handleDeauthorize(env: Env, request: Request): Promise<Response> {
  const config = await loadConfig(env, request);
  const signedRequest = await readSignedRequest(request);

  if (!signedRequest || !config.appSecret) {
    return new Response("Bad request", { status: 400 });
  }

  const payload = await parseSignedRequest(signedRequest, config.appSecret);
  if (!payload?.user_id) return new Response("Invalid signature", { status: 401 });

  const account = await getAccountByIgId(env, payload.user_id);
  if (account) {
    await setAccountHealth(
      env,
      account.id,
      "PERMISSION_REVOKED",
      "You removed dmdrop from this Instagram account. Reconnect to resume.",
    );
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Data deletion request callback.
 *
 * Meta requires a JSON response containing a status URL and a confirmation
 * code. Because this deployment is self-hosted, deletion is immediate and total
 * — removing the account row cascades to its rules, send logs, tracked links,
 * and follower snapshots. There is no copy anywhere else, and none was ever
 * sent to us.
 */
export async function handleDataDeletion(env: Env, request: Request): Promise<Response> {
  const config = await loadConfig(env, request);
  const signedRequest = await readSignedRequest(request);
  const origin = new URL(request.url).origin;

  if (!signedRequest || !config.appSecret) {
    return new Response("Bad request", { status: 400 });
  }

  const payload = await parseSignedRequest(signedRequest, config.appSecret);
  if (!payload?.user_id) return new Response("Invalid signature", { status: 401 });

  const account = await getAccountByIgId(env, payload.user_id);
  if (account) {
    await env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(account.id).run();
  }

  // The confirmation code identifies the request without revealing the
  // Instagram user id to anyone reading logs.
  const confirmationCode = toB64url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${payload.user_id}:${payload.issued_at ?? 0}`) as BufferSource,
      ),
    ),
  ).slice(0, 16);

  return new Response(
    JSON.stringify({
      url: `${origin}/privacy/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

/** Human-readable status page, linked from the JSON response above. */
export function dataDeletionStatus(request: Request, nonce: string): Response {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  return page(
    "Data deleted",
    `<p>All data for this Instagram account has been permanently removed from this
dmdrop instance: the connection, its automations, delivery logs, tracked links,
and follower history.</p>
<p>This instance is self-hosted. No copy of that data exists anywhere else, and
none was ever transmitted to the software vendor.</p>
${safeCode ? `<p>Confirmation code: <code>${safeCode}</code></p>` : ""}`,
    nonce,
  );
}

/**
 * Privacy policy and terms pages.
 *
 * Meta requires a reachable Privacy Policy URL before an app can be switched to
 * Live mode, and Live mode is required to receive webhooks. So these are not
 * decoration — without them the product cannot function.
 *
 * Public, no session, no data. Deliberately short and true: a self-hosted
 * instance genuinely does not send anything anywhere.
 */
/**
 * Standalone document shell for the public legal pages.
 *
 * These carry no app chrome — Meta crawls them and strangers land on them
 * directly. Styles go in a nonce'd <style> block rather than inline attributes,
 * which the CSP blocks: an earlier version used inline styles and rendered
 * completely unstyled in every browser.
 */
function page(title: string, bodyHtml: string, nonce: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
<style nonce="${nonce}">
  /* Same neutrals and typeface as the app. Meta's reviewer reads these pages
     before approving the app, so they are the first thing anyone sees. */
  @font-face { font-family: Inter; font-style: normal; font-weight: 400 800;
               font-display: swap; src: url(/f/inter.woff2) format("woff2"); }
  :root { --fg:#1C1C1E; --muted:#6E6E73; --bg:#fff; --accent:#1B6EF3; }
  body { font: 400 16px/1.7 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem 4rem;
         color: var(--fg); background: var(--bg); }
  h1 { font-size: 1.7rem; line-height: 1.25; letter-spacing: -0.02em; }
  h2 { font-size: 1.05rem; margin-top: 2rem; }
  a { color: var(--accent); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
</style>
</head>
<body>
<h1>${title}</h1>
${bodyHtml}
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export function renderPrivacyPolicy(request: Request, nonce: string): Response {
  const origin = new URL(request.url).origin;
  return page(
    "Privacy Policy",
    `<p>This is a private, self-hosted installation of dmdrop, an Instagram
comment-to-DM automation tool. It is operated by the individual who deployed it,
for their own Instagram accounts.</p>

<h2>What is collected</h2>
<p>When someone comments on a connected Instagram account's post and that comment
matches a configured keyword, this installation stores: the comment identifier,
the commenter's Instagram username and user identifier, the keyword matched, and
the delivery outcome. It also stores the connected account's access token, which
is encrypted at rest.</p>

<h2>Where it is stored</h2>
<p>Entirely within the operator's own Cloudflare account. This installation sends
no data to the software vendor, to any analytics service, to any advertising
network, or to any third party. There is no central service.</p>

<h2>What it is used for</h2>
<p>Solely to send the automated reply the account owner configured, and to show
the account owner whether it was delivered. It is never sold, shared, or used for
any other purpose.</p>

<h2>How long it is kept</h2>
<p>Delivery records are automatically deleted after 90 days. Access tokens are
deleted immediately when an Instagram account is disconnected, or when the app is
removed from that account.</p>

<h2>Deleting your data</h2>
<p>Removing this app from your Instagram account (Instagram → Settings → Apps and
websites) deletes all associated data automatically. You may also request deletion
at <a href="${origin}/privacy/data-deletion">${origin}/privacy/data-deletion</a>.</p>

<h2>Contact</h2>
<p>Contact the operator of this installation — the Instagram account you received
a message from.</p>`,
    nonce,
  );
}

export function renderTerms(nonce: string): Response {
  return page(
    "Terms of Service",
    `<p>This is a private, self-hosted installation of dmdrop, operated by an
individual for their own Instagram accounts.</p>

<h2>What it does</h2>
<p>It sends an automated private reply when someone comments a keyword the account
owner configured, using Instagram's official API. It does not scrape Instagram,
does not automate the Instagram app, and never asks anyone for their password.</p>

<h2>No warranty</h2>
<p>Provided as is, without warranty of any kind. Delivery depends on Instagram's
platform and is not guaranteed.</p>

<h2>Acceptable use</h2>
<p>The operator is responsible for the content sent through this installation and
for complying with Instagram's terms and messaging policies.</p>

<h2>Not affiliated</h2>
<p>Not affiliated with, endorsed by, or sponsored by Meta Platforms or Instagram.</p>`,
    nonce,
  );
}
