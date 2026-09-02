/**
 * Sessions and CSRF.
 *
 * A signed cookie, no server-side session store. One operator, one instance —
 * a sessions table would buy nothing and cost a D1 round trip on every request.
 *
 * Cookie flags, and why each one:
 *   HttpOnly          script cannot read it, so an XSS bug cannot steal the session
 *   Secure            never transmitted over plain HTTP
 *   SameSite=Lax      the browser will not attach it to cross-site POSTs, which
 *                     blocks the common CSRF shape before our own token is even
 *                     consulted
 *   Path=/            one scope, one cookie
 *   Max-Age           bounded lifetime; a stolen cookie expires
 */

import { randomId, sign, timingSafeEqual, toB64url, fromB64url, verifySigned } from "./crypto";

const COOKIE_NAME = "cl_session";
const MAX_AGE_SECONDS = 7 * 24 * 3600;

export interface Session {
  sub: string;
  iat: number;
  exp: number;
  /** Per-session CSRF token. Never leaves the session cookie and the form. */
  csrf: string;
}

export async function createSession(secret: string): Promise<{ session: Session; cookie: string }> {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = {
    sub: "admin",
    iat: now,
    exp: now + MAX_AGE_SECONDS,
    csrf: randomId(24),
  };

  const payload = toB64url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await sign(payload, secret);
  const value = `${payload}.${signature}`;

  return {
    session,
    cookie: `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`,
  };
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export async function getSession(request: Request, secret: string): Promise<Session | null> {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  // Signature is checked BEFORE the payload is parsed. Parsing attacker-supplied
  // JSON that has not been authenticated is how parser bugs become exploits.
  if (!(await verifySigned(payload, signature, secret))) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof session.exp !== "number" || session.exp < Math.floor(Date.now() / 1000)) return null;
    if (session.sub !== "admin") return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * CSRF check for state-changing requests.
 *
 * Belt and braces alongside SameSite=Lax: the token is bound to the session, so
 * a forged cross-origin POST cannot supply it even if a browser attaches the
 * cookie. Compared in constant time.
 *
 * Origin is validated too, because SameSite has historically had gaps and
 * costs nothing to double-check.
 */
export function checkCsrf(session: Session, submitted: string | null, request: Request): boolean {
  if (!submitted || !timingSafeEqual(submitted, session.csrf)) return false;

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
