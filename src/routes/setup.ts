/**
 * Setup wizard.
 *
 * This is the business model, not a feature. The buyer is a creator, not an
 * engineer, and the single hardest thing they must do is create a Meta
 * developer app — roughly 20 minutes in a console designed for developers.
 *
 * Every ambiguity here becomes a support message, and at this price point
 * support is the only cost that matters. So: one decision per screen, the exact
 * values to paste rendered as copyable fields, and the destination named before
 * the instruction. A video splits their attention across two windows; steps in
 * the app do not.
 *
 * Laid out to the dmdrop Figma "Screens / Setup 1–4" artboards: a centred lede
 * on the two short steps, numbered cards on the long Configure step with the
 * Meta breadcrumb printed under each field, and a permission checklist before
 * the hand-off to Instagram.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, csrfField, notice, copyField, COPY_SCRIPT, icon } from "../lib/ui";
import { hashPassword } from "../lib/crypto";
import { setSetting } from "../lib/db";
import {
  SETTING,
  saveMetaCredentials,
  setupState,
  ensureVerifyToken,
  licenceKey,
  type SetupState,
} from "../lib/config";
import type { Session } from "../lib/session";

/** Named steps, so a half-finished setup says where it stopped. */
function progress(step: number): ReturnType<typeof html> {
  const names = ["Account", "Configure", "Connect"];
  const parts = names.map((name, i) => {
    const n = i + 1;
    const state = n < step ? "done" : n === step ? "on" : "";
    const mark = n < step ? "&#10003;" : String(n);
    return `<span class="st ${state}"><span class="dot">${mark}</span>${name}</span>`;
  });
  return html`<div class="stepper">${raw(parts.join('<span class="bar"></span>'))}</div>`;
}

/** Which screen to show, derived from state rather than stored as a cursor. */
export function currentStep(state: SetupState): number {
  if (!state.passwordSet) return 1;
  if (!state.metaConfigured) return 2;
  if (!state.accountConnected) return 3;
  return 4;
}

/**
 * Password reveal and strength meter.
 *
 * Both are progressive enhancement. With scripting off the fields are ordinary
 * password inputs and the meter simply never fills — nothing here gates the
 * form, and the real minimum is enforced server-side in handleSetPassword.
 */
const SETUP_SCRIPT = `
(function () {
  document.querySelectorAll('[data-peek]').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var field = document.getElementById(btn.getAttribute('data-peek'));
      if (!field) return;
      var shown = field.type === 'text';
      field.type = shown ? 'password' : 'text';
      btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
      btn.setAttribute('aria-pressed', shown ? 'false' : 'true');
    });
  });

  var pw = document.getElementById('pw');
  var meter = document.getElementById('meter');
  if (!pw || !meter) return;
  var bars = meter.querySelectorAll('i');
  var label = document.getElementById('meter-label');
  var names = ['', 'Weak', 'Fair', 'Good', 'Strong'];

  pw.addEventListener('input', function () {
    var v = pw.value;
    // ponytail: length-and-variety heuristic, not entropy. Swap in zxcvbn only
    // if it ever has to gate anything — today it is advisory.
    var score = 0;
    if (v.length >= 12) score++;
    if (v.length >= 16) score++;
    if (/[^a-zA-Z]/.test(v)) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (v.length < 12) score = v.length ? 1 : 0;
    for (var i = 0; i < bars.length; i++) bars[i].className = i < score ? 'on' : '';
    label.textContent = names[score] ? names[score] + ' password' : '';
  });
})();
`;

export async function renderSetup(
  env: Env,
  request: Request,
  nonce: string,
  session: Session | null,
  message = "",
  error = "",
): Promise<Response> {
  const state = await setupState(env);
  const step = currentStep(state);
  const origin = new URL(request.url).origin;

  // Step 1 is the only screen reachable without a session — nothing else is
  // exposed until a password exists, and once it does the operator must be
  // signed in to continue.
  if (step > 1 && !session) {
    return Response.redirect(`${origin}/login`, 302);
  }

  const body =
    step === 1
      ? step1()
      : step === 2
        ? step2(origin, session!, await ensureVerifyToken(env), Boolean(await licenceKey(env)))
        : step === 3
          ? step3(session!)
          : step4();

  const page = layout(
    {
      title: "Set up dmdrop",
      nonce,
      session: Boolean(session),
      script: `${COPY_SCRIPT}\n${SETUP_SCRIPT}`,
    },
    html`${progress(Math.min(step, 3))}
      ${notice("bad", error)}${notice("ok", message)}${body}`,
  );

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function passwordField(id: string, name: string, label: string, hint: string, autofocus = false) {
  return html`
    <label for="${id}">${label}${hint ? raw(`<span class="hint">${hint}</span>`) : ""}</label>
    <div class="pw">
      <input type="password" id="${id}" name="${name}" minlength="12" required
             autocomplete="new-password"${raw(autofocus ? " autofocus" : "")}>
      <button type="button" class="peek" data-peek="${id}" hidden
              aria-label="Show password" aria-pressed="false">${icon("eye", 20)}</button>
    </div>
  `;
}

function step1() {
  return html`
    <div class="auth">
      <div class="lede-c">
        <span class="logo"><span class="mark">${icon("bolt", 20)}</span>dmdrop</span>
        <h1>Create your password</h1>
        <p>This protects your dashboard. It is yours alone — nobody else can sign
           in, and it never leaves your instance.</p>
      </div>

      <form method="post" action="/setup/password">
        ${passwordField("pw", "password", "Password", "At least 12 characters.", true)}
        <div class="meter" id="meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="meter-label" id="meter-label"></div>

        ${passwordField("pw2", "confirm", "Confirm password", "")}

        <p class="mt-24"><button type="submit" class="block">Continue</button></p>
        <p class="foot">
          There is no reset email by design — no email provider exists here.
          Forgetting it means redeploying.
        </p>
      </form>
    </div>
  `;
}

function step2(origin: string, session: Session, verifyToken: string, hasLicence: boolean) {
  return html`
    <div class="lede-l">
      <h1>Connect Instagram</h1>
      <p>Two ways. Pick either — you can change your mind later without losing
         anything.</p>
    </div>

    <div class="card">
      <span class="overline">The quick way</span>
      <div class="tile">
        <span class="ic">${icon("bolt", 20)}</span>
        <div class="grow">
          <div class="title">Connect with dmdrop</div>
          <div class="sub">
            About 30 seconds. No Meta developer account, no console. Your
            comments and DMs reach you through our relay, and everything else —
            your automations, your contacts, your link clicks, your Instagram
            token — stays on this instance.
          </div>
        </div>
      </div>
      ${
        hasLicence
          ? html`<form method="post" action="/connect/dmdrop/start" class="mt-12">
              ${csrfField(session.csrf)}
              <button type="submit" class="block">Connect with dmdrop</button>
            </form>`
          : /*
             * Without a licence the broker refuses to register this instance,
             * so offering the button here would only produce a redirect back to
             * this page. Ask for the key instead — it is the same field that
             * lives in Settings, which the setup gate has not unlocked yet.
             */
            html`<form method="post" action="/setup/licence" class="mt-12">
              ${csrfField(session.csrf)}
              <label for="lic">Licence key<span class="hint">In your purchase email.</span></label>
              <input type="text" id="lic" name="licence_key" class="mono"
                     placeholder="DD1...." autocomplete="off" required>
              <p class="mt-14"><button type="submit" class="block">Save licence and continue</button></p>
            </form>`
      }
    </div>

    <div class="card">
      <span class="overline">The independent way</span>
      <p class="small muted mt-0">
        About 15 minutes in Meta's console, and afterwards nothing of ours is in
        the path at all — not even for incoming messages. Choose this if you
        would rather depend on nobody, or if you are running this for clients.
        The steps are below.
      </p>
    </div>

    <div class="card">
      <div class="stepnum"><span class="n">1</span><h3>Create the app</h3></div>
      <ol class="small steps-list mt-0">
        <li>Open <a href="https://developers.facebook.com/apps" target="_blank"
            rel="noopener noreferrer">developers.facebook.com/apps</a> and sign in.</li>
        <li>Click <strong>Create app</strong>. Choose <strong>Other</strong>, then
            <strong>Business</strong>. Name it anything — but nothing containing
            "Instagram", "Facebook" or "Meta", which Meta rejects.</li>
        <li>Add the <strong>Instagram</strong> product, choosing
            <strong>API setup with Instagram business login</strong>.</li>
        <li>Open the <strong>Roles</strong> tab and add your Instagram account as an
            <strong>Instagram Tester</strong>. Accept the invite at
            <a href="https://www.instagram.com/accounts/manage_access/" target="_blank"
               rel="noopener noreferrer">instagram.com/accounts/manage_access</a> —
            the mobile app usually hides tester invites.</li>
      </ol>
    </div>

    <div class="card">
      <div class="stepnum"><span class="n">2</span><h3>Copy these into Meta</h3></div>
      <p class="small muted mt-0">
        These four live in three different places. Each one says where.
      </p>

      <label>OAuth Redirect URI</label>
      ${copyField(`${origin}/connect/callback`, "cp9775")}
      <p class="under">
        Instagram &rarr; API setup with Instagram business login &rarr;
        3. Set up Instagram business login. Paste exactly — no trailing slash.
      </p>

      <label>Data deletion callback URL</label>
      ${copyField(`${origin}/privacy/data-deletion`, "cp4401")}
      <p class="under">
        App settings &rarr; Basic &rarr; User data deletion. Switch the dropdown to
        <em>callback URL</em>, not "instructions URL".
      </p>

      <label>Deauthorize callback URL</label>
      ${copyField(`${origin}/privacy/deauthorize`, "cp4402")}
      <p class="under">
        Same panel as the redirect URI. Often absent on Instagram-only apps —
        skip it if you cannot find it, the endpoint works either way.
      </p>

      <label>Webhook callback URL</label>
      ${copyField(`${origin}/webhooks/instagram`, "cp3266")}
      <p class="under">Instagram &rarr; 2. Configure webhooks.</p>

      <div class="notice warn">
        After saving the webhook you must also subscribe to the
        <strong>comments</strong> field. Miss it and everything looks correct
        while no DM ever sends.
      </div>
    </div>

    <div class="card">
      <div class="stepnum"><span class="n">3</span><h3>Privacy and terms</h3></div>
      <p class="small muted mt-0">
        Meta only delivers webhooks to apps in <strong>Live</strong> mode, and will
        not let you switch to Live until a privacy policy is set. Both pages are
        already running on your instance.
      </p>
      <label>Privacy Policy URL</label>
      ${copyField(`${origin}/privacy`, "cp5501")}
      <label>Terms of Service URL</label>
      ${copyField(`${origin}/terms`, "cp5502")}
      <p class="under">App settings &rarr; Basic.</p>
      <p class="small muted">
        Save those, pick any Category, then flip <strong>App Mode</strong> to
        <strong>Live</strong> beside your app name. This does <em>not</em> need App
        Review — Live plus your Tester role is enough for your own account.
      </p>
    </div>

    <div class="card">
      <div class="stepnum"><span class="n">4</span><h3>Enter your app credentials</h3></div>
      <form method="post" action="/setup/meta">
        ${csrfField(session.csrf)}
        <label for="appId">Instagram app ID</label>
        <input type="text" id="appId" name="app_id" class="mono" required
               inputmode="numeric" autocomplete="off" placeholder="e.g. 1789926195758311">
        <p class="under">
          From the <strong>API setup with Instagram business login</strong> screen.
          <strong>Not</strong> the App ID in the page header — that is the Facebook
          app id and it will not work.
        </p>

        ${passwordField("appSecret", "app_secret", "Instagram app secret",
          "Encrypted before it is stored. Click \"Show\" in Meta to reveal it.")}
        <p class="under">Same screen, directly under the app ID.</p>

        <label>Webhook verify token</label>
        ${copyField(`${verifyToken}`, "cp7788")}
        <p class="under">Generated for you — paste this same value into Meta.</p>

        <p class="mt-24"><button type="submit" class="block">Save and continue</button></p>
      </form>
    </div>
  `;
}

function step3(session: Session) {
  return html`
    <div class="auth">
      <div class="lede-c">
        <h1>Connect your Instagram</h1>
        <p>You will be sent to Instagram to approve access. Nothing is stored
           anywhere but your own instance.</p>
      </div>

      <div class="card">
        <div class="conn">
          <span class="node us">${icon("bolt", 26)}</span>
          <span class="swap">${icon("swap", 22)}</span>
          <span class="node them">${icon("insta", 26)}</span>
        </div>
        <p class="small muted conn-label">Secure encrypted connection</p>
      </div>

      <ul class="checks">
        <li>
          <span class="tick">${icon("check", 14)}</span>
          <div>
            <div class="title">Send and receive DMs</div>
            <div class="sub">So your automation can reply with your link.</div>
          </div>
        </li>
        <li>
          <span class="tick">${icon("check", 14)}</span>
          <div>
            <div class="title">Read public comments</div>
            <div class="sub">To spot your keywords when somebody comments.</div>
          </div>
        </li>
        <li>
          <span class="tick">${icon("check", 14)}</span>
          <div>
            <div class="title">Nothing else</div>
            <div class="sub">No follower export, no posting, no reading your inbox.</div>
          </div>
        </li>
      </ul>

      <p class="small muted mt-24">
        Your account must be a <strong>Business</strong> or <strong>Creator</strong>
        account. Switching is free: Instagram app &rarr; Settings &rarr; Account type
        and tools.
      </p>

      <form method="post" action="/connect/start" class="mt-12">
        ${csrfField(session.csrf)}
        <button type="submit" class="block ig">
          ${icon("insta", 20)} Connect with Instagram
        </button>
      </form>
    </div>
  `;
}

function step4() {
  return html`
    <div class="auth">
      <div class="lede-c">
        <span class="logo"><span class="mark">${icon("check", 20)}</span>Ready</span>
        <h1>You're set up</h1>
        <p>Create your first automation and try it on a real post from another
           account — your own comments are ignored on purpose.</p>
      </div>
      <p><a class="btn block" href="/campaigns/new">Create your first automation</a></p>
      <p class="mt-12"><a class="btn block secondary" href="/">Go to the dashboard</a></p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleSetPassword(env: Env, form: FormData): Promise<string | null> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password !== confirm) return "The two passwords do not match.";

  await setSetting(env, SETTING.passwordHash, await hashPassword(password));
  return null;
}

export async function handleSaveMeta(env: Env, form: FormData): Promise<string | null> {
  const appId = String(form.get("app_id") ?? "").trim();
  const appSecret = String(form.get("app_secret") ?? "").trim();
  // Read back rather than accepting it from the form: the token is generated and
  // persisted server-side, the field on screen is read-only, and a value posted
  // here could otherwise overwrite the one Meta was already verified against.
  const verifyToken = await ensureVerifyToken(env);

  if (!/^\d{6,32}$/.test(appId)) return "App ID should be the numeric Instagram app ID.";
  if (appSecret.length < 16) return "That app secret looks too short — copy the full value.";

  await saveMetaCredentials(env, appId, appSecret, verifyToken);
  return null;
}
