/**
 * Router, queue consumer, and cron entrypoint.
 *
 * Authentication and CSRF are enforced HERE, centrally, rather than inside each
 * handler. A per-route check is a check somebody eventually forgets to add; a
 * central gate fails closed for anything new by default.
 */

import type { Env, SendJob } from "./env";
import { newNonce, securityHeaders } from "./lib/security";
import { getSession, checkCsrf, type Session } from "./lib/session";
import { setupState, instanceId, licenceKey } from "./lib/config";
import { reportActivation, buildId } from "./lib/license";
import { handleBatch } from "./queue/consumer";
import { runDailyMaintenance } from "./cron";
import { interWoff2 } from "./lib/font";
import { ensureSchema, targetVersion } from "./lib/migrate";
import { missingSecrets, renderPreflight } from "./routes/preflight";

import { renderLogin, handleLogin, handleLogout } from "./routes/auth";
import { renderSetup, handleSetPassword, handleSaveMeta } from "./routes/setup";
import { startConnect, finishConnect } from "./routes/connect";
import { verifySubscription, receiveWebhook, processRaw } from "./routes/webhook";
import {
  startBrokerConnect,
  receiveBrokerToken,
  receiveRelayedWebhook,
  receiveRevocation,
  switchToOwnApp,
  brokerUrl,
  connectError,
  brokerConnectDone,
} from "./routes/broker";
import {
  handleDeauthorize,
  handleDataDeletion,
  dataDeletionStatus,
  renderPrivacyPolicy,
  renderTerms,
} from "./routes/privacy";
import { renderDashboard } from "./routes/dashboard";
import { renderEditor, saveRule, deleteRule } from "./routes/campaigns";
import { renderCampaignDetail } from "./routes/campaign-detail";
import { renderLogs } from "./routes/logs";
import { renderHelp } from "./routes/help";
import { renderTemplates } from "./routes/templates";
import { renderContacts, exportContacts } from "./routes/contacts";
import {
  renderSettings,
  handleSaveLicence,
  handleSaveMetaCredentials,
  handleChangePassword,
  handleDisconnect,
  storeOrigin,
} from "./routes/settings";

export { RateLimiter } from "./do/rate-limiter";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/setup",
  "/setup/password",
  "/health",
  "/manifest.webmanifest",
  "/f/inter.woff2",
  // Called by the broker, server to server. No session exists; both verify an
  // HMAC signed with this instance's shared secret before doing anything.
  "/connect/dmdrop",
  "/connect/dmdrop/revoked",
  "/webhooks/dmdrop",
  // Meta calls these directly; both authenticate by signed_request, not session.
  "/privacy/deauthorize",
  "/privacy/data-deletion",
  // Meta requires a reachable Privacy Policy URL before an app may go Live,
  // and Live mode is required to receive webhooks.
  "/privacy",
  "/terms",
]);

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/webhooks/") ||
    pathname.startsWith("/l/")
  );
}

/** Attach security headers to every HTML response we generate. */
function harden(response: Response, nonce: string, brokerOrigin?: string): Response {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders(nonce, brokerOrigin))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const nonce = newNonce();

    try {
      // --- Always-public, non-HTML endpoints ------------------------------
      if (path === "/health") {
        // Schema version included so a failed migration is visible without
        // opening the logs — the one thing most likely to go wrong on a
        // deployment nobody watched.
        await ensureSchema(env);
        return new Response(`ok schema=${targetVersion()}`, {
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (path === "/manifest.webmanifest") return manifest();

      // Before anything that needs them. A deployment whose secrets were never
      // set cannot sign a session or encrypt a token, so it explains itself
      // rather than failing with a 500 nobody can act on.
      const missing = missingSecrets(env as unknown as Record<string, unknown>);
      if (missing.length > 0) {
        return harden(renderPreflight(nonce, missing, "dmdrop"), nonce);
      }

      // Brings a brand-new deployment's database into existence, and an
      // upgraded one up to date. Cached per isolate, so this is a no-op on
      // every request after the first of a cold start.
      await ensureSchema(env);

      if (path === "/f/inter.woff2") {
        return new Response(interWoff2(), {
          headers: {
            "Content-Type": "font/woff2",
            // Content-addressed by nothing, but the file only changes when the
            // Worker is redeployed, and a redeploy is the only thing that can
            // change the URL's contents. A year is safe and keeps the font off
            // every subsequent page load.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      if (path === "/connect/dmdrop") {
        return request.method === "POST"
          ? await receiveBrokerToken(env, request)
          : new Response("Method not allowed", { status: 405 });
      }

      // Where the broker returns the browser after Instagram. Public because no
      // session survives the round trip through instagram.com in every browser,
      // and it reveals nothing — it only chooses which of our own pages to show.
      if (path === "/connect/dmdrop/done") return await brokerConnectDone(env, request);

      if (path === "/connect/dmdrop/revoked") {
        return request.method === "POST"
          ? await receiveRevocation(env, request)
          : new Response("Method not allowed", { status: 405 });
      }

      if (path === "/webhooks/dmdrop") {
        return request.method === "POST"
          ? await receiveRelayedWebhook(env, request, (raw) => processRaw(env, raw))
          : new Response("Method not allowed", { status: 405 });
      }

      if (path === "/webhooks/instagram") {
        return request.method === "GET"
          ? await verifySubscription(env, request)
          : request.method === "POST"
            ? await receiveWebhook(env, request)
            : new Response("Method not allowed", { status: 405 });
      }

      if (path === "/privacy") return renderPrivacyPolicy(request, nonce);
      if (path === "/terms") return renderTerms(nonce);

      // Meta-facing callbacks. Required by Instagram Business Login settings,
      // and authenticated by signed_request rather than by session.
      if (path === "/privacy/deauthorize") return await handleDeauthorize(env, request);

      if (path === "/privacy/data-deletion") {
        // GET with a ?code= is the human status page Meta links to; a POST (or
        // a GET carrying signed_request) is the deletion request itself.
        const hasSignedRequest =
          request.method === "POST" || url.searchParams.has("signed_request");
        return hasSignedRequest
          ? await handleDataDeletion(env, request)
          : dataDeletionStatus(request, nonce);
      }

      if (path.startsWith("/l/")) return await trackedRedirect(env, ctx, path.slice(3));

      // --- Session ---------------------------------------------------------
      const session = await getSession(request, env.SESSION_SECRET);

      // Every state-changing request must carry a valid, session-bound CSRF
      // token. Checked before any handler runs so a new POST route cannot ship
      // without protection.
      let form: FormData | null = null;
      if (request.method === "POST") {
        try {
          form = await request.formData();
        } catch {
          return new Response("Expected a form submission.", { status: 400 });
        }

        // Exactly two POSTs may run without a session, because both exist to
        // create one:
        //   /login            — there is no session yet, by definition
        //   /setup/password   — first run, before any credential exists
        // The second is allowed ONLY while no password is set, so it cannot be
        // replayed later to overwrite the operator's password.
        const preAuth =
          path === "/login" ||
          (path === "/setup/password" && !(await setupState(env)).passwordSet);

        if (!preAuth) {
          if (!session) return redirect("/login");
          if (!checkCsrf(session, String(form.get("_csrf") ?? ""), request)) {
            return new Response("Invalid or expired form. Reload the page and try again.", {
              status: 403,
            });
          }
        }
      }

      if (!session && !isPublic(path)) return redirect("/login");

      // --- Setup gate ------------------------------------------------------
      const state = await setupState(env);
      const setupExempt =
        path.startsWith("/setup") ||
        path.startsWith("/connect") ||
        // /login is only a valid destination once a password exists. On a fresh
        // instance it is a dead end — a sign-in form with nothing to sign in to
        // — so send first-time visitors to the wizard instead.
        (path === "/login" && state.passwordSet) ||
        // Without this, a half-configured instance traps the operator in the
        // wizard with no way to sign out.
        path === "/logout";

      if (!state.complete && !setupExempt) return redirect("/setup");

      if (session) ctx.waitUntil(storeOrigin(env, request));

      // --- Routes ----------------------------------------------------------
      const response = await route(env, request, ctx, path, nonce, session, form);
      return harden(response, nonce, brokerUrl(env));
    } catch (error) {
      // Never leak internals to the browser. The detail goes to the log, where
      // only the operator can see it.
      console.error("[router]", error);
      return new Response("Something went wrong. Check your Worker logs.", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },

  async queue(batch: MessageBatch<SendJob>, env: Env): Promise<void> {
    await handleBatch(batch, env);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyMaintenance(env));
  },
};

async function route(
  env: Env,
  request: Request,
  ctx: ExecutionContext,
  path: string,
  nonce: string,
  session: Session | null,
  form: FormData | null,
): Promise<Response> {
  const post = request.method === "POST";

  // --- Auth ---------------------------------------------------------------
  if (path === "/login") {
    if (post) return handleLogin(env, request, form!, nonce);
    return session ? redirect("/") : renderLogin(nonce);
  }
  if (path === "/logout") return handleLogout();

  // --- Setup --------------------------------------------------------------
  if (path === "/setup") return renderSetup(env, request, nonce, session, "", connectError(request));

  if (path === "/setup/password" && post) {
    const error = await handleSetPassword(env, form!);
    if (error) return renderSetup(env, request, nonce, session, "", error);
    return redirect("/login");
  }

  // The licence lives in Settings, which the setup gate hides until setup is
  // finished — and the one-tap connect needs it BEFORE then. Same handler.
  if (path === "/setup/licence" && post) {
    const error = await handleSaveLicence(env, form!);
    return renderSetup(env, request, nonce, session, error ? "" : "Licence saved.", error ?? "");
  }

  if (path === "/setup/meta" && post) {
    const error = await handleSaveMeta(env, form!);
    return error
      ? renderSetup(env, request, nonce, session, "", error)
      : redirect("/setup");
  }

  // --- Instagram connect ---------------------------------------------------
  if (path === "/connect/start" && post) return startConnect(env, request, session!, nonce);
  if (path === "/connect/dmdrop/start" && post) return startBrokerConnect(env, request);

  if (path === "/settings/own-app" && post) {
    await switchToOwnApp(env);
    return redirect("/setup");
  }
  if (path === "/connect/callback") return finishConnect(env, request, session!, nonce);

  // --- Dashboard -----------------------------------------------------------
  if (path === "/") {
    // Fire-and-forget activation ping. Fails open; nothing waits on it.
    ctx.waitUntil(pingActivation(env));
    return renderDashboard(env, request, nonce);
  }

  if (path === "/logs") return renderLogs(env, request, nonce);
  if (path === "/help") return renderHelp(nonce);
  if (path === "/templates") return renderTemplates(nonce);
  if (path === "/contacts") return renderContacts(env, nonce);
  // Behind the session gate like every other route. A contact list is the most
  // sensitive thing this instance holds.
  if (path === "/contacts.csv") return exportContacts(env);

  // --- Settings ------------------------------------------------------------
  if (path === "/settings")
    return renderSettings(env, request, nonce, session!, "", connectError(request));

  if (path === "/settings/meta" && post) {
    const error = await handleSaveMetaCredentials(env, form!);
    return renderSettings(
      env, request, nonce, session!,
      error ? "" : "Meta credentials saved.", error ?? "",
    );
  }

  if (path === "/settings/licence" && post) {
    const error = await handleSaveLicence(env, form!);
    return renderSettings(env, request, nonce, session!, error ? "" : "Licence saved.", error ?? "");
  }

  if (path === "/settings/password" && post) {
    const error = await handleChangePassword(env, form!);
    return renderSettings(env, request, nonce, session!, error ? "" : "Password updated.", error ?? "");
  }

  if (path === "/settings/disconnect" && post) {
    await handleDisconnect(env, form!);
    return redirect("/settings");
  }

  // --- Campaigns -----------------------------------------------------------
  if (path === "/campaigns/new") {
    if (!post) return renderEditor(env, request, nonce, session!, null);
    const result = await saveRule(env, form!, null);
    return result.ok
      ? redirect("/")
      : renderEditor(env, request, nonce, session!, null, result.error);
  }

  const campaignMatch = /^\/campaigns\/([A-Za-z0-9_-]{1,32})(\/delete|\/edit)?$/.exec(path);
  if (campaignMatch) {
    const ruleId = campaignMatch[1]!;

    if (campaignMatch[2] === "/delete") {
      if (!post) return new Response("Method not allowed", { status: 405 });
      // The confirmation checkbox is `required` in the browser, but a form post
      // is not a browser. This cascades to the delivery history and the click
      // counts, so it is re-checked here.
      if (form!.get("confirm") !== "yes") return redirect(`/campaigns/${ruleId}`);
      await deleteRule(env, ruleId);
      return redirect("/");
    }

    // Tapping an automation shows its own numbers. Editing is a step further in,
    // so a glance at how something is performing never risks changing it.
    if (!campaignMatch[2]) {
      if (post) return new Response("Method not allowed", { status: 405 });
      return renderCampaignDetail(env, nonce, session!, ruleId);
    }

    if (!post) return renderEditor(env, request, nonce, session!, ruleId);
    const result = await saveRule(env, form!, ruleId);
    return result.ok
      ? redirect(`/campaigns/${ruleId}`)
      : renderEditor(env, request, nonce, session!, ruleId, result.error);
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Tracked link redirect.
 *
 * Public and hot: someone tapping a link in a DM must never wait on a database
 * write, so the click counter is incremented without awaiting and a failure
 * there cannot break the redirect.
 */
async function trackedRedirect(
  env: Env,
  ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  if (!/^[a-z0-9]{4,16}$/.test(slug)) return new Response("Not found", { status: 404 });

  const link = await env.DB.prepare("SELECT id, target_url FROM tracked_links WHERE slug = ?")
    .bind(slug)
    .first<{ id: string; target_url: string }>();

  if (!link) return new Response("Not found", { status: 404 });

  // ctx.waitUntil, NOT a bare floating promise. The Workers runtime cancels
  // outstanding work the moment the response is returned, so a fire-and-forget
  // update is simply dropped — clicks silently never counted. waitUntil keeps
  // the request alive for the write without making the visitor wait for it.
  ctx.waitUntil(
    env.DB.prepare("UPDATE tracked_links SET clicks = clicks + 1 WHERE id = ?")
      .bind(link.id)
      .run()
      .then(() => undefined)
      .catch((error) => {
        console.error("[click] failed to record click", error);
      }),
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: link.target_url,
      // Never cache: a cached redirect means uncounted clicks.
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function pingActivation(env: Env): Promise<void> {
  const key = await licenceKey(env);
  if (!key || !env.ACTIVATION_ENDPOINT) return;
  await reportActivation(key, await instanceId(env), env.ACTIVATION_ENDPOINT, buildId(env));
}

function manifest(): Response {
  return new Response(
    JSON.stringify({
      name: "dmdrop",
      short_name: "dmdrop",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#1b6ef3",
      icons: [],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
