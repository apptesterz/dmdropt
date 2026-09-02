/**
 * The screen a broken deployment shows instead of a 500.
 *
 * Two secrets have no sensible default: SESSION_SECRET signs the login cookie,
 * TOKEN_ENCRYPTION_KEY encrypts the Instagram token. Neither can be invented at
 * runtime — a generated session secret would sign out every user on each cold
 * start, and a generated encryption key stored in the database it protects
 * would make the encryption pointless.
 *
 * So if they are missing the instance genuinely cannot work. What it CAN do is
 * say so in words a creator can act on. Without this they get an opaque error
 * on a deployment they just paid for, which is a refund and a support message.
 */

import { html } from "../lib/html";
import { layout, icon } from "../lib/ui";

/** Secrets with no safe default. Order matters — it is the order shown. */
const REQUIRED = [
  {
    name: "SESSION_SECRET",
    what: "Signs the cookie that keeps you logged in.",
  },
  {
    name: "TOKEN_ENCRYPTION_KEY",
    what: "Encrypts your Instagram access token where it is stored.",
  },
] as const;

export function missingSecrets(env: Record<string, unknown>): string[] {
  return REQUIRED.filter((secret) => {
    const value = env[secret.name];
    return typeof value !== "string" || value.trim().length === 0;
  }).map((secret) => secret.name);
}

export function renderPreflight(nonce: string, missing: string[], workerName: string): Response {
  const body = html`
    <div class="auth">
      <div class="lede-c">
        <span class="logo"><span class="mark">${icon("bolt", 20)}</span>dmdrop</span>
        <h1>Almost there</h1>
        <p>Your instance deployed correctly. It needs two secret values before it
           can start, and adding them takes about two minutes.</p>
      </div>

      <div class="card">
        <span class="overline">Still needed</span>
        ${missing.map(
          (name) => html`<div class="tile">
            <span class="ic">${icon("key", 20)}</span>
            <div class="grow">
              <div class="title mono">${name}</div>
              <div class="sub">
                ${REQUIRED.find((secret) => secret.name === name)?.what ?? ""}
              </div>
            </div>
          </div>`,
        )}
      </div>

      <div class="card">
        <span class="overline">How to add them</span>
        <ol class="small steps-list mt-0">
          <li>Open <a href="https://connect.dmdrop.in/keys" target="_blank"
              rel="noopener noreferrer">connect.dmdrop.in/keys</a> and keep it open.
              It makes the two values in your own browser — nobody else ever sees them.</li>
          <li>Go to <strong>dash.cloudflare.com</strong> → <strong>Workers &amp; Pages</strong>
              → <strong>${workerName}</strong> → <strong>Settings</strong> →
              <strong>Variables and Secrets</strong>.</li>
          <li><strong>Add</strong> each one. Set <strong>Type</strong> to
              <strong>Secret</strong>, not Text — a Text variable is readable by
              anyone with dashboard access and gets wiped on the next deploy.</li>
          <li>Press <strong>Deploy</strong> on that panel. The change does nothing
              until you do, and this is the step people miss.</li>
          <li>Come back here and refresh.</li>
        </ol>
        <p class="small muted">
          Save both somewhere safe first. Losing the session one signs everybody
          out; losing the encryption one means reconnecting Instagram.
        </p>
      </div>

      <p class="foot">
        Stuck? <a href="mailto:baviskoo@gmail.com">baviskoo@gmail.com</a>
      </p>
    </div>
  `;

  return new Response(
    layout({ title: "Finish setting up dmdrop", nonce }, body),
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
