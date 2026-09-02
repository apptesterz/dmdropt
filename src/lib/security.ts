/**
 * Response security headers and request throttling helpers.
 */

import type { Env } from "../env";

/**
 * Applied to every HTML response.
 *
 * The CSP is deliberately strict and the app is built to live inside it: no
 * inline event handlers, no eval, no third-party scripts, no external fonts.
 * Inline <style> and <script> are permitted only with the per-response nonce,
 * so an injected tag without the nonce will not execute even if escaping is
 * somehow bypassed. This is defence in depth behind `html.ts`, not instead of
 * it.
 */
export function securityHeaders(nonce: string, brokerOrigin?: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      // No 'unsafe-inline' anywhere, for scripts or styles. A nonce does not
      // cover inline style attributes, and the directive that would
      // (style-src-attr) is not supported in every browser — so the app uses
      // utility classes instead of inline styles and needs no exception at all.
      `style-src 'nonce-${nonce}'`,
      // Instagram media thumbnails come from Meta's CDN on arbitrary subdomains.
      "img-src 'self' data: https:",
      "connect-src 'self'",
      // The typeface is served from this Worker, never from a font CDN.
      "font-src 'self'",
      // form-action must also allow Instagram's OAuth host.
      //
      // Chrome applies this directive to the FINAL destination after redirects,
      // not just the immediate POST target. The "Connect Instagram" form posts
      // to our own origin and is then 302'd to instagram.com — with 'self'
      // alone Chrome silently cancels that navigation, producing a button that
      // does nothing at all and logs no server-side error.
      //
      // Listed explicitly rather than relaxed to '*': these two hosts are the
      // only off-site destinations any form here may reach.
      // The broker is included because "Connect with dmdrop" posts here and is
      // then redirected there. Chrome checks this directive against the FINAL
      // destination, so omitting it cancels the navigation with no error at
      // all — the button appears to do nothing and the page just sits there.
      // Exactly the failure documented above for instagram.com.
      `form-action 'self' https://www.instagram.com https://api.instagram.com${
        brokerOrigin ? ` ${brokerOrigin}` : ""
      }`,
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    // The dashboard is per-operator data; never let a proxy hold it.
    "Cache-Control": "no-store, must-revalidate",
  };
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "");
}

function limiter(env: Env, name: string) {
  return env.RATE.get(env.RATE.idFromName(name));
}

/**
 * Login throttle: 8 attempts per 15 minutes, keyed by client IP.
 *
 * Not keyed by username — there is exactly one account, so a per-account key
 * would let an attacker from any IP lock the real operator out of their own
 * instance. Keying by IP means an attacker throttles only themselves.
 */
export async function checkLoginAttempt(
  env: Env,
  request: Request,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const result = await limiter(env, "login").reserve(`ip:${ip}`, 8, 15 * 60);
  return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
}

export async function clearLoginAttempts(env: Env, request: Request): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  await limiter(env, "login").reset(`ip:${ip}`);
}

/** Per-account hourly ceiling on private replies. */
export async function reserveSendSlot(env: Env, accountId: string) {
  const max = Number(env.IG_PRIVATE_REPLY_HOURLY_CAP ?? 750);
  return limiter(env, `send:${accountId}`).reserve("hour", max, 3600);
}

export async function releaseSendSlot(env: Env, accountId: string): Promise<void> {
  await limiter(env, `send:${accountId}`).release("hour");
}

export async function currentSendUsage(env: Env, accountId: string) {
  const usage = await limiter(env, `send:${accountId}`).current("hour");
  return { ...usage, cap: Number(env.IG_PRIVATE_REPLY_HOURLY_CAP ?? 750) };
}
