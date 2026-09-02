/**
 * Settings — account health, licence, Meta credentials, password, disconnect.
 *
 * Laid out to the dmdrop Figma "Screens / Settings" artboard: a stack of cards,
 * each labelled with an overline inside it, and the destructive action isolated
 * in a danger zone at the bottom.
 *
 * The design's own cards are for a hosted product — an email address, email
 * notification toggles, Delete Account. None of those exist here: there is no
 * email provider, no user record, and no server but the customer's own. The
 * card language is the design's; the contents are what this product actually
 * has, and the danger zone holds the one action that really does destroy data.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, csrfField, notice, copyField, COPY_SCRIPT, icon } from "../lib/ui";
import { listAccounts, setSetting, getSetting } from "../lib/db";
import { SETTING, licenceKey, ensureVerifyToken, loadConfig, saveMetaCredentials } from "../lib/config";
import { connectMode } from "./broker";
import { verifyLicence } from "../lib/license";
import { hashPassword } from "../lib/crypto";
import type { Session } from "../lib/session";

export async function renderSettings(
  env: Env,
  request: Request,
  nonce: string,
  session: Session,
  message = "",
  error = "",
): Promise<Response> {
  const accounts = await listAccounts(env);
  const key = await licenceKey(env);
  const licence = key ? await verifyLicence(key) : null;
  const origin = new URL(request.url).origin;
  const verifyToken = await ensureVerifyToken(env);
  const config = await loadConfig(env, request);
  const mode = await connectMode(env);

  const body = html`
    ${notice("ok", message)}${notice("bad", error)}

    <div class="card">
      <span class="overline">Instagram connection</span>
      ${
        accounts.length === 0
          ? html`<div class="tile">
              <span class="ic">${icon("insta", 20)}</span>
              <div class="grow">
                <div class="title">No account connected</div>
                <div class="sub">dmdrop cannot send anything until you connect one.</div>
              </div>
            </div>`
          : accounts.map(
              (account) => html`<div class="tile">
                <span class="ic">${icon("insta", 20)}</span>
                <div class="grow">
                  <div class="title">@${account.username}</div>
                  <div class="sub">
                    ${
                      account.health === "OK"
                        ? raw('<span class="chip ok">Connected</span>')
                        : raw(`<span class="chip bad">${account.health}</span>`)
                    }
                  </div>
                </div>
              </div>`,
            )
      }
      <p class="small muted">
        ${
          mode === "dmdrop"
            ? raw(
                "Connected through dmdrop. Your messages are sent from this instance " +
                  "with your own token — only incoming comments and DMs are relayed.",
              )
            : raw("Connected with your own Meta app. Nothing routes through dmdrop.")
        }
      </p>

      <form method="post" action="${mode === "dmdrop" ? "/connect/dmdrop/start" : "/connect/start"}" class="mt-12">
        ${csrfField(session.csrf)}
        <button type="submit" class="block secondary">
          ${accounts.length ? "Reconnect Instagram" : "Connect Instagram"}
        </button>
      </form>
    </div>

    ${
      mode === "own"
        ? html`<div class="card">
            <span class="overline">Easier connection</span>
            <p class="small mt-0">
              You are running your own Meta app, which means nothing routes
              through dmdrop at all. That is the most independent setup and
              there is no need to change it.
            </p>
            <p class="small muted">
              If you would rather not maintain a Meta app, you can connect
              through dmdrop instead — one tap, no developer console. Your
              comments and DMs would then reach you through our relay. Your
              automations, contacts and token stay here either way, and you can
              switch back at any time.
            </p>
            <form method="post" action="/connect/dmdrop/start">
              ${csrfField(session.csrf)}
              <button type="submit" class="block secondary">Connect with dmdrop instead</button>
            </form>
          </div>`
        : raw("")
    }

    ${
      mode === "dmdrop"
        ? html`<div class="card">
            <span class="overline">Independence</span>
            <p class="small mt-0">
              You can move to your own Meta app whenever you like. Your
              automations, contacts, link clicks and delivery history all stay
              exactly where they are — this only changes how Instagram reaches
              you. It takes about 15 minutes in Meta's console.
            </p>
            <p class="small muted">
              Worth doing if you would rather depend on nobody, or if dmdrop ever
              shuts down.
            </p>
            <form method="post" action="/settings/own-app">
              ${csrfField(session.csrf)}
              <button type="submit" class="block secondary">Switch to my own Meta app</button>
            </form>
          </div>`
        : raw("")
    }

    <div class="card">
      <span class="overline">Licence</span>
      ${
        licence?.valid
          ? html`<div class="tile">
                <span class="ic">${icon("key", 20)}</span>
                <div class="grow">
                  <div class="title">${licence.edition}</div>
                  <div class="sub">
                    ${licence.buyerName} ·
                    ${licence.accountLimit === 0 ? "unlimited" : licence.accountLimit} account(s)
                  </div>
                </div>
                <span class="chip ok">Active</span>
              </div>
              <p class="small muted mt-12">
                ${
                  licence.updatesActive
                    ? `Updates included until ${licence.updatesUntil?.toISOString().slice(0, 10)}.`
                    : "Your update period has ended. dmdrop keeps working — you simply will not receive new versions."
                }
              </p>`
          : html`<form method="post" action="/settings/licence">
              ${csrfField(session.csrf)}
              <label for="lic">Licence key</label>
              <input type="text" id="lic" name="licence_key" class="mono"
                     placeholder="DD1...." autocomplete="off">
              <p class="mt-14"><button type="submit" class="block">Save licence</button></p>
            </form>`
      }
    </div>

    ${mode === "dmdrop" ? raw("") : html`<div class="card">
      <span class="overline">Meta app credentials</span>
      <p class="small muted mt-0">
        Take these from <strong>API setup with Instagram business login</strong> —
        the <strong>Instagram app ID</strong> and <strong>Instagram app secret</strong>
        shown at the top of that screen. The App ID in the page header is the
        Facebook app id and will not work.
      </p>
      <form method="post" action="/settings/meta">
        ${csrfField(session.csrf)}
        <label for="mid">Instagram app ID</label>
        <input type="text" id="mid" name="app_id" class="mono" required
               inputmode="numeric" autocomplete="off" value="${config.appId}">
        <label for="msec">Instagram app secret
          <span class="hint">
            ${config.appSecret ? "Stored. Re-enter to replace it." : "Not set."}
          </span>
        </label>
        <input type="password" id="msec" name="app_secret" class="mono" required
               autocomplete="off" placeholder="Paste the Instagram app secret">
        <p class="mt-14"><button type="submit" class="block secondary">Save credentials</button></p>
      </form>
    </div>`}

    <div class="card">
      <span class="overline">Password</span>
      <form method="post" action="/settings/password">
        ${csrfField(session.csrf)}
        <label for="pw">New password <span class="hint">At least 12 characters.</span></label>
        <input type="password" id="pw" name="password" minlength="12" required
               autocomplete="new-password">
        <label for="pw2">Confirm</label>
        <input type="password" id="pw2" name="confirm" minlength="12" required
               autocomplete="new-password">
        <p class="mt-14"><button type="submit" class="block secondary">Update password</button></p>
      </form>
    </div>

    ${mode === "dmdrop" ? raw("") : html`<div class="card">
      <span class="overline">Meta setup</span>
      <p class="small muted mt-0">Paste these into your Meta app if you ever need them again.</p>
      <label>Webhook callback URL</label>
      <div class="copy"><input type="text" class="mono" readonly value="${origin}/webhooks/instagram"></div>
      <label>Redirect URI</label>
      <div class="copy"><input type="text" class="mono" readonly value="${origin}/connect/callback"></div>
      <label>Webhook verify token
        <span class="hint">The value Meta checks against when verifying the webhook.</span>
      </label>
      ${copyField(`${verifyToken}`, "cs5920")}
    </div>`}

    ${
      accounts.length === 0
        ? raw("")
        : html`<div class="card danger">
            <span class="overline">Danger zone</span>
            <p class="small mt-0">
              Disconnecting an account deletes every automation on it, all its
              delivery history, and every tracked link with the clicks recorded
              against it. This cannot be undone.
            </p>
            ${
              // One form per account. This used to hardcode accounts[0], which
              // meant that with more than one connected, the button named one
              // account and destroyed the other's data.
              accounts.map(
                (account) => html`<form method="post" action="/settings/disconnect" class="mt-14">
                  ${csrfField(session.csrf)}
                  <input type="hidden" name="account_id" value="${account.id}">
                  <div class="row">
                    <input type="checkbox" id="sure-${account.id}" name="confirm" value="yes" required>
                    <label for="sure-${account.id}" class="small">
                      Yes, delete <strong>@${account.username}</strong> and its history.
                    </label>
                  </div>
                  <button type="submit" class="block danger-solid">
                    Disconnect @${account.username}
                  </button>
                </form>`,
              )
            }
          </div>`
    }

    <p class="ver">dmdrop · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  `;

  return new Response(
    layout(
      {
        title: "Settings",
        heading: "Settings",
        nonce,
        session: true,
        tab: "settings",
        script: COPY_SCRIPT,
      },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function handleSaveMetaCredentials(env: Env, form: FormData): Promise<string | null> {
  const appId = String(form.get("app_id") ?? "").trim();
  const appSecret = String(form.get("app_secret") ?? "").trim();
  const verifyToken = await ensureVerifyToken(env);

  if (!/^\d{6,32}$/.test(appId)) return "App ID should be the numeric Instagram app ID.";
  if (appSecret.length < 16) return "That app secret looks too short — copy the full value.";

  await saveMetaCredentials(env, appId, appSecret, verifyToken);
  return null;
}

export async function handleSaveLicence(env: Env, form: FormData): Promise<string | null> {
  const key = String(form.get("licence_key") ?? "").trim();
  const licence = await verifyLicence(key);
  if (!licence.valid) return licence.reason ?? "That licence key is not valid.";
  await setSetting(env, SETTING.licenceKey, key);
  return null;
}

export async function handleChangePassword(env: Env, form: FormData): Promise<string | null> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password !== confirm) return "The two passwords do not match.";
  await setSetting(env, SETTING.passwordHash, await hashPassword(password));
  return null;
}

export async function handleDisconnect(env: Env, form: FormData): Promise<void> {
  const accountId = String(form.get("account_id") ?? "");
  // The checkbox is `required` in the browser, but a form post is not a
  // browser. This is a cascading delete — check it server-side too.
  if (!accountId || form.get("confirm") !== "yes") return;
  // Cascades to rules, send logs, tracked links, and snapshots.
  await env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId).run();
}

export async function storeOrigin(env: Env, request: Request): Promise<void> {
  const origin = new URL(request.url).origin;
  if ((await getSetting(env, SETTING.origin)) !== origin) {
    await setSetting(env, SETTING.origin, origin);
  }
}
