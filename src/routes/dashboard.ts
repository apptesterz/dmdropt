/**
 * Dashboard.
 *
 * Click-through rate leads, deliberately. "DMs sent" says nothing about whether
 * the thing worked; clicks say whether anyone wanted what was offered. It is the
 * number a creator screenshots, so it gets the hero card.
 *
 * Every figure here is one the platform actually reports. Open rates and read
 * receipts are not among them — Instagram does not provide either, to anyone,
 * at any price. Showing them would mean inventing numbers.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, notice, icon } from "../lib/ui";
import { listAccounts, type AccountRow } from "../lib/db";
import { monthlyUsage } from "../lib/metering";
import { currentSendUsage } from "../lib/security";

interface Totals {
  matched: number;
  sent: number;
  failed: number;
  awaiting: number;
  clicks: number;
}

async function totals(env: Env): Promise<Totals> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*)                                                          AS matched,
       COALESCE(SUM(CASE WHEN dm_sent_at IS NOT NULL THEN 1 END), 0)     AS sent,
       COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 END), 0)          AS failed,
       COALESCE(SUM(CASE WHEN status = 'AWAITING_FOLLOW' THEN 1 END), 0) AS awaiting
     FROM send_log`,
  ).first<{ matched: number; sent: number; failed: number; awaiting: number }>();

  const clicks = await env.DB.prepare(
    "SELECT COALESCE(SUM(clicks), 0) AS clicks FROM tracked_links",
  ).first<{ clicks: number }>();

  return {
    matched: row?.matched ?? 0,
    sent: row?.sent ?? 0,
    failed: row?.failed ?? 0,
    awaiting: row?.awaiting ?? 0,
    clicks: clicks?.clicks ?? 0,
  };
}

interface RuleSummary {
  id: string;
  name: string;
  active: number;
  trigger_type: string;
  expires_at: number | null;
  last_fired: number | null;
  matched: number;
  sent: number;
  clicks: number;
  /** Shown only when more than one account is connected. */
  account_username: string;
}

async function ruleSummaries(env: Env): Promise<RuleSummary[]> {
  const result = await env.DB.prepare(
    `SELECT r.id, r.name, r.active, r.trigger_type, r.expires_at,
            acc.username AS account_username,
            s.last_fired,
            COALESCE(s.matched, 0) AS matched,
            COALESCE(s.sent, 0)    AS sent,
            COALESCE(l.clicks, 0)  AS clicks
       FROM rules r
       JOIN accounts acc ON acc.id = r.account_id
       LEFT JOIN (
         SELECT rule_id,
                COUNT(*) AS matched,
                MAX(created_at) AS last_fired,
                SUM(CASE WHEN dm_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent
           FROM send_log GROUP BY rule_id
       ) s ON s.rule_id = r.id
       LEFT JOIN (
         SELECT rule_id, SUM(clicks) AS clicks FROM tracked_links GROUP BY rule_id
       ) l ON l.rule_id = r.id
      ORDER BY r.created_at DESC`,
  ).all<RuleSummary>();
  return result.results ?? [];
}

function ctr(clicks: number, sent: number): string {
  if (sent === 0) return "—";
  return `${Math.round((clicks / sent) * 100)}%`;
}

/**
 * Bar width for the hero, as a whole-number percentage.
 *
 * Clamped rather than trusted: clicks can legitimately exceed sends — one
 * person taps the same link twice — and a 140%-wide bar would overflow its
 * track. The number above the bar still reports the true rate.
 */
function ratePercent(clicks: number, sent: number): number {
  if (sent === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((clicks / sent) * 100)));
}

function triggerLabel(trigger: string): string {
  if (trigger === "DM") return "DM";
  if (trigger === "STORY_REPLY") return "Story reply";
  if (trigger === "STORY_MENTION") return "Story mention";
  return "Comment";
}

/**
 * Flags a rule that has quietly stopped mattering.
 *
 * A story lives a day; an automation made for it lives forever unless somebody
 * removes it. Months later it is still answering with a dead link and nobody
 * has noticed. Expired and long-idle rules are called out so that never becomes
 * a silent state.
 */
function statusChip(rule: RuleSummary): ReturnType<typeof raw> {
  const now = Math.floor(Date.now() / 1000);

  if (rule.expires_at && rule.expires_at <= now) {
    return raw('<span class="chip bad">Expired</span>');
  }
  if (!rule.active) return raw('<span class="chip warn">Paused</span>');
  if (rule.expires_at) {
    const days = Math.ceil((rule.expires_at - now) / 86400);
    return raw(`<span class="chip warn">Stops in ${days}d</span>`);
  }
  if (rule.last_fired && now - rule.last_fired > 30 * 86400) {
    return raw('<span class="chip warn">Idle 30d+</span>');
  }
  return raw('<span class="chip ok">Active</span>');
}

export async function renderDashboard(
  env: Env,
  request: Request,
  nonce: string,
): Promise<Response> {
  const [accounts, stats, rules, usage] = await Promise.all([
    listAccounts(env),
    totals(env),
    ruleSummaries(env),
    monthlyUsage(env),
  ]);

  const connected = new URL(request.url).searchParams.has("connected");
  const unhealthy = accounts.filter((a) => a.health !== "OK");
  // The hourly ceiling is enforced per Instagram account, so one figure cannot
  // describe two of them. Fetched for each, and rendered per account when there
  // is more than one.
  const hourly = await Promise.all(
    accounts.map(async (account) => ({
      username: account.username,
      usage: await currentSendUsage(env, account.id),
    })),
  );

  const body = html`
    ${connected ? notice("ok", "Instagram connected.") : ""}
    ${unhealthy.map((account) => healthBanner(account))}

    <div class="hero">
      <div class="top"><span class="k">Click-through rate</span></div>
      <div class="n">${ctr(stats.clicks, stats.sent)}${
        stats.sent === 0 ? raw('<span class="sub">no sends yet</span>') : raw("")
      }</div>
      ${
        // The bar's fill is the rate. Sends and taps sit at either end of it, so
        // the one figure this product argues matters has a size you can see
        // rather than a percentage you have to picture.
        stats.sent === 0
          ? raw("")
          : html`<div class="rate"><i></i></div>
              <div class="ends">
                <span><b>${stats.sent}</b> received a message</span>
                <span><b>${stats.clicks}</b> tapped the link</span>
              </div>`
      }
    </div>

    <div class="stats">
      <div class="stat"><div class="k">DMs sent</div><div class="n">${stats.sent}</div></div>
      <div class="stat"><div class="k">Link clicks</div><div class="n">${stats.clicks}</div></div>
      <div class="stat"><div class="k">Matched</div><div class="n">${stats.matched}</div></div>
      <div class="stat"><div class="k">Failed</div><div class="n">${stats.failed}</div></div>
    </div>

    <div class="sec-head">
      <h2>Your automations</h2>
      ${
        rules.length === 0
          ? raw("")
          : html`<span class="sec-actions">
              <a class="btn sm secondary" href="/templates">Templates</a>
              <a class="btn sm" href="/campaigns/new">New automation</a>
            </span>`
      }
    </div>
    ${
      rules.length === 0
        ? html`<div class="card">
              <div class="empty">
                <div class="icon">${icon("spark", 24)}</div>
                <h3>No automations yet</h3>
                <p class="small muted">
                  Make one, then comment your keyword on the post to watch it work.
                </p>
              </div>
            </div>
            <a class="btn block" href="/templates">Start from a template</a>
            <p class="mt-12"><a class="btn block secondary" href="/campaigns/new">
              Start from scratch
            </a></p>`
        : html`<div class="rows">
              ${rules.map(
                (rule) => html`<a class="row-link" href="/campaigns/${rule.id}">
                  <span class="grow">
                    <span class="title">${rule.name}</span>
                    <span class="meta">
                      ${statusChip(rule)}
                      <span class="chip accent">${triggerLabel(rule.trigger_type)}</span>
                      ${
                        accounts.length > 1
                          ? raw(`<span class="chip">@${rule.account_username}</span>`)
                          : raw("")
                      }
                      <span>CTR: ${ctr(rule.clicks, rule.sent)}</span>
                    </span>
                  </span>
                  <span class="chev">${icon("chevron", 20)}</span>
                </a>`,
              )}
            </div>`
    }

    <h2>This instance</h2>
    <div class="stats two">
      <div class="stat">
        <div class="k">Monthly sends</div>
        <div class="n">${usage.used}</div>
      </div>
      ${
        hourly.length === 0
          ? html`<div class="stat"><div class="k">Hourly</div><div class="n">—</div></div>`
          : hourly.map(
              (entry) => html`<div class="stat">
                <div class="k">
                  ${hourly.length > 1 ? `Hourly · @${entry.username}` : "Hourly"}
                </div>
                <div class="n">${entry.usage.used} / ${entry.usage.cap}</div>
              </div>`,
            )
      }
      ${
        stats.awaiting > 0
          ? html`<div class="stat">
              <div class="k">Waiting on a follow</div>
              <div class="n">${stats.awaiting}</div>
            </div>`
          : raw("")
      }
      <div class="stat wide">
        <div class="k">${accounts.length > 1 ? "Connected accounts" : "Connected account"}</div>
        <div class="n">${accounts.map((a) => `@${a.username}`).join(", ") || "Not connected"}</div>
      </div>
    </div>
  `;

  return new Response(
    layout(
      {
        title: "dmdrop",
        heading: "Home",
        nonce,
        session: true,
        tab: "home",
        // Server-computed and clamped to 0–100 above; no request data reaches it.
        style: `.hero .rate i{width:${ratePercent(stats.clicks, stats.sent)}%}`,
      },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Account-level problems get one prominent, plain-language banner rather than
 * hundreds of identical failed rows in the log.
 */
function healthBanner(account: AccountRow) {
  const explanation: Record<string, string> = {
    TOKEN_EXPIRED: "Instagram signed us out. Reconnect to start sending again.",
    PERMISSION_REVOKED: "A required Instagram permission was removed. Reconnect to restore it.",
    NOT_PROFESSIONAL: "This account is no longer a Business or Creator account.",
  };
  return html`<div class="notice bad">
    <strong>@${account.username} is paused.</strong>
    ${explanation[account.health] ?? account.health_note ?? "Reconnect this account."}
    <a href="/settings">Fix it</a>
  </div>`;
}
