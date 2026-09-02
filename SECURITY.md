# Security

What this instance does to protect itself, and what it deliberately does not do.

The starting position is unusually good: **dmdrop is self-hosted, so there is no central service to breach.** Your tokens, campaigns, logs, and recipients live in your Cloudflare account and nowhere else. Nothing is transmitted to the vendor. A compromise of us cannot become a compromise of you.

---

## Secrets

| Secret | Where it lives | Protection |
|---|---|---|
| Instagram access token | D1 | AES-256-GCM, key held outside the database |
| Meta app secret | D1 | AES-256-GCM |
| Admin password | D1 | PBKDF2-SHA256, 3 chained rounds of 100,000 (300,000 effective), 16-byte random salt |
| `TOKEN_ENCRYPTION_KEY` | Worker secret | never in the database it protects |
| `SESSION_SECRET` | Worker secret | signs session cookies |

The encryption key is **not** stored alongside the ciphertext, so a database dump alone cannot decrypt anything.

AES-**GCM**, not CBC, because it authenticates: a tampered ciphertext fails to decrypt instead of producing plausible garbage. Every encryption uses a fresh 96-bit nonce — reusing one under a single key destroys GCM's guarantees entirely.

## Passwords

PBKDF2-SHA256. Not bcrypt or Argon2 — neither exists in the Workers runtime, and inventing a substitute would be worse than using a standard primitive correctly.

**The runtime refuses any single PBKDF2 call above 100,000 iterations**, which is well below current guidance. Rather than accept a weak hash, the derivation is *chained*: three sequential rounds at the platform maximum, each feeding the next, for 300,000 iterations of attacker work with every individual call staying legal. The rounds are sequential and interdependent, so they cannot be parallelised any more than one long derivation could.

Cost parameters are read back **from the stored hash**, never from the constants, so raising either later re-hashes nobody and locks out nobody.

This was found in production, not in testing: Node has no such cap, so the original 210,000 passed every local test and failed instantly on deploy.

## Login

- Throttled to 8 attempts per 15 minutes, enforced by a Durable Object.
- Keyed by **client IP, not by account.** There is exactly one account, so an account-keyed throttle would let anyone on the internet lock the real operator out of their own instance. Keyed by IP, an attacker throttles only themselves.
- Throttle is checked *before* the password is verified, so response timing cannot distinguish "wrong password" from "not even checked".
- Failures say only "Incorrect password" — never whether a password exists or how close the attempt was.
- Password comparison is constant-time.

## Sessions

Signed cookie, HMAC-SHA256. No server-side session store — one operator, one instance, and a sessions table would add a database round trip to every request while buying nothing.

Flags: `HttpOnly` (script cannot read it, so an XSS bug cannot steal it), `Secure`, `SameSite=Lax` (the browser will not attach it to cross-site POSTs), `Path=/`, 7-day `Max-Age`.

**The signature is verified before the payload is parsed.** Parsing attacker-supplied JSON that has not been authenticated is how parser bugs become exploits.

## CSRF

Two independent layers:

1. `SameSite=Lax` blocks the common cross-site POST shape at the browser.
2. A per-session token, compared in constant time, plus an `Origin` header check.

Enforced **centrally in the router**, before any handler runs. A per-route check is a check someone eventually forgets to add on a new route; the central gate fails closed by default.

Exactly two POST routes may run without a session, because both exist to create one: `/login`, and `/setup/password` **only while no password is set** — so it cannot be replayed later to overwrite the operator's password.

## Webhooks

The webhook endpoint is public, so without verification anyone could forge comment events and burn the operator's hourly Instagram quota.

- HMAC-SHA256 over the **raw request body**. Re-serialising parsed JSON reorders keys and changes whitespace, so the digest would not match — the raw bytes are the only correct input.
- Constant-time digest comparison.
- Body capped at 512 KB before any parsing, so an unbounded body cannot become free CPU.
- Unsigned requests are rejected with 401, before any database work.
- The subscription verify token is also compared in constant time.

## Injection

**SQL.** Every query uses D1 prepared statements with bound parameters. There is exactly one place where a SQL fragment is assembled rather than fully literal — the update in `db.ts` — and its column names are checked against an explicit runtime allowlist on top of the TypeScript types.

**HTML.** The `html` template tag escapes every interpolated value by default; emitting unescaped content requires explicitly wrapping it in `raw()`. That inversion matters because forgetting to escape is the default failure mode of string-built HTML — here, forgetting produces escaped output. Commenter usernames and campaign text both reach these templates and both originate outside our control.

**URLs.** Tracked link destinations must pass `safeExternalUrl`, which permits only `http:` and `https:`. Without it, a `javascript:` destination would be stored XSS for anyone tapping through from a DM.

## Content Security Policy

```
default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…';
img-src 'self' data: https:; connect-src 'self';
form-action 'self' https://www.instagram.com https://api.instagram.com;
base-uri 'none'; frame-ancestors 'none'; object-src 'none'
```

**No `'unsafe-inline'` anywhere**, for scripts or styles. The app is built to live inside this: no inline event handlers, no `eval`, no third-party scripts, no external fonts.

Inline `style=""` attributes are *not* covered by a style nonce, and the directive that would cover them (`style-src-attr`) is not supported in every browser. Rather than weaken the policy, the app uses utility classes and has no inline styles at all.

`form-action` names Instagram's OAuth hosts explicitly. Chrome applies that directive to the *final* destination after redirects, so with `'self'` alone it silently cancelled the OAuth navigation — a button that did nothing, with no error anywhere. Listed as two exact hosts rather than relaxed to a wildcard.

Also set: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Permissions-Policy` denying geolocation/mic/camera/payment, and `Cache-Control: no-store` on dashboard pages.

## OAuth

The connect flow is where an access token is obtained, so it is the highest-value step to attack.

`state` is **signed and bound to the session**, and carries a 10-minute expiry. Without this, an attacker could complete the flow with their own authorisation code and silently attach *their* Instagram account to the operator's instance — harvesting every DM the operator's automations would have sent.

The authorisation code is never logged. Failure messages are deliberately vague about *why* validation failed.

## Rate limiting and abuse

- Per-account hourly send ceiling, matching Instagram's documented figure, enforced as an **atomic reservation** in a Durable Object. "Read, decide, increment" as separate steps would let two workers both observe 749 and both send.
- Overflow is requeued with a delay, never dropped, and requeues are capped so a permanently failing job cannot cycle forever.
- Duplicate sends are impossible by database constraint, not by application logic.

## Error handling

Unhandled errors return a generic message; detail goes to the Worker log where only the operator can read it. Platform errors surfaced in the delivery log are translated into plain language rather than raw codes — which is a support decision as much as a security one.

## What is deliberately absent

- **No email provider.** No password-reset flow, therefore no password-reset vulnerability, and one fewer account for the buyer to create. Recovery is by redeploying with a new password.
- **No multi-user system.** No roles, no invitations, no tenancy — and no way to get any of them wrong.
- **No third-party scripts, analytics, or error trackers.** The only outbound hosts are Meta's.
- **Almost no JavaScript.** One ~20-line nonce'd script adapts the automation editor's labels to the selected trigger. It is progressive enhancement only — every screen works fully with scripting disabled, and the server never trusts anything it does.
- **No licence phone-home requirement.** Verification is offline; the optional activation ping fails open and nothing waits on it.

## Known limitations

Stated plainly rather than hidden:

- **A determined licensee can remove the licence check.** They have the source. This is true of all perpetual software; the real deterrent is that updates and support are gated, and a stale copy breaks when Meta changes the API.
- **No 2FA.** A single strong password plus IP throttling, on a URL nobody else knows. 2FA without an email or SMS provider would mean TOTP enrolment during setup, which trades a real increase in setup abandonment for a modest security gain. Reconsider if the threat model changes.
- **`style-src-attr` is intentionally unused** — see the CSP section.
- **Click counting is fire-and-forget.** Under heavy concurrency a small number of clicks may be lost. Making a person tapping a link in a DM wait on a database write would be the worse trade.

## Reporting

Found something? `baviskoo@gmail.com`. Please do not open a public issue for a security report.
