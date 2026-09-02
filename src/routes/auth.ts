/**
 * Sign in / sign out.
 *
 * One account, one password. No registration, no reset-by-email — there is no
 * email provider in this deployment, which is one fewer service the buyer must
 * sign up for. Recovery is by redeploying with a new password, documented in
 * the README.
 */

import type { Env } from "../env";
import { html } from "../lib/html";
import { layout, notice } from "../lib/ui";
import { verifyPassword } from "../lib/crypto";
import { adminPasswordHash } from "../lib/config";
import { createSession, clearSessionCookie } from "../lib/session";
import { checkLoginAttempt, clearLoginAttempts } from "../lib/security";

export function renderLogin(nonce: string, error = ""): Response {
  const page = layout(
    { title: "Sign in", nonce },
    html`
      <div class="auth">
        <div class="lede">
          <h1>Welcome back</h1>
          <p>Sign in to manage your automations</p>
        </div>
        ${notice("bad", error)}
        <form method="post" action="/login">
          <label for="pw">Password</label>
          <input type="password" id="pw" name="password" required autofocus
                 autocomplete="current-password" placeholder="Your password">
          <div class="actions">
            <button type="submit" class="block">Sign in</button>
          </div>
        </form>
        <p class="foot">
          Forgotten it? There is no reset email by design — set a new one by
          redeploying.
        </p>
      </div>
    `,
  );
  return new Response(page, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function handleLogin(
  env: Env,
  request: Request,
  form: FormData,
  nonce: string,
): Promise<Response> {
  // Throttle before touching the password, so an attacker cannot use response
  // time to distinguish "wrong password" from "not even checked".
  const throttle = await checkLoginAttempt(env, request);
  if (!throttle.allowed) {
    return renderLoginThrottled(nonce, throttle.retryAfterSeconds);
  }

  const stored = await adminPasswordHash(env);
  const password = String(form.get("password") ?? "");

  // No password configured yet means setup has not run. Do not silently allow
  // entry — send them to the wizard.
  if (!stored) return Response.redirect(new URL("/setup", request.url).toString(), 302);

  if (!(await verifyPassword(password, stored))) {
    // Deliberately vague: never reveal whether a password exists, its length,
    // or how close the attempt was.
    return renderLogin(nonce, "Incorrect password.");
  }

  await clearLoginAttempts(env, request);

  const { cookie } = await createSession(env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": cookie },
  });
}

function renderLoginThrottled(nonce: string, retryAfterSeconds: number): Response {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const page = layout(
    { title: "Too many attempts", nonce },
    html`
      <div class="auth">
        <div class="lede">
          <h1>Too many attempts</h1>
          <p>
            Sign-in is paused for about ${minutes} minute${minutes === 1 ? "" : "s"}.
          </p>
        </div>
        <p class="foot">
          This protects your instance from password guessing. Nothing is wrong
          with your account.
        </p>
      </div>
    `,
  );
  return new Response(page, {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

export function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: "/login", "Set-Cookie": clearSessionCookie() },
  });
}
