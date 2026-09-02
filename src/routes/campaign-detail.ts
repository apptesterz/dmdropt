/**
 * One automation's own numbers.
 *
 * Built to the dmdrop Figma "Screens / Automation Detail" artboard: overview
 * stats with click-through rate as the hero, four tiles, per-button
 * performance, the follow funnel, and recent activity.
 *
 * The design's funnel counts followers before and after. That is not something
 * this product can attribute — Instagram reports a follower total, not who
 * followed because of which automation, and claiming otherwise would be
 * inventing a number. The funnel here tracks the thing the follow gate actually
 * does: matched, opener sent, still waiting, delivered.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, icon, csrfField, notice } from "../lib/ui";
import { findConflicts, describeConflicts } from "../lib/conflicts";
import type { Session } from "../lib/session";

/**
 * Only the columns this page reads.
 *
 * The last five exist for the conflict check, which needs to compare this rule
 * against its siblings — so they are selected rather than cast in.
 */
interface RuleRow {
  id: string;
  account_id: string;
  name: string;
  active: number;
  trigger_type: "COMMENT" | "DM" | "STORY_REPLY" | "STORY_MENTION";
  expires_at: number | null;
  require_follow: number;
  media_id: string | null;
  keywords: string;
  match_any: number;
  is_default: number;
}

interface Counts {
  matched: number;
  sent: number;
  failed: number;
  awaiting: number;
}

interface LinkRow {
  label: string | null;
  target_url: string;
  clicks: number;
}

interface EventRow {
  commenter_name: string | null;
  status: string;
  created_at: number;
}

function ago(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function rate(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

/** Bar width, clamped — one person can tap the same link twice. */
function ratePercent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

function triggerLabel(trigger: string): string {
  if (trigger === "DM") return "Someone sends a DM";
  if (trigger === "STORY_REPLY") return "Someone replies to a story";
  if (trigger === "STORY_MENTION") return "Someone mentions you in their story";
  return "Someone comments on a post";
}

function statusChip(rule: RuleRow) {
  const now = Math.floor(Date.now() / 1000);
  if (rule.expires_at && rule.expires_at <= now) {
    return raw('<span class="chip bad">Expired</span>');
  }
  if (!rule.active) return raw('<span class="chip warn">Paused</span>');
  if (rule.expires_at) {
    const days = Math.ceil((rule.expires_at - now) / 86400);
    return raw(`<span class="chip warn">Stops in ${days}d</span>`);
  }
  return raw('<span class="chip ok">Active</span>');
}

function eventChip(status: string) {
  if (status === "SENT") return raw('<span class="chip ok">Delivered</span>');
  if (status === "FAILED") return raw('<span class="chip bad">Failed</span>');
  if (status === "AWAITING_FOLLOW") return raw('<span class="chip warn">Waiting</span>');
  return raw('<span class="chip">Queued</span>');
}

export async function renderCampaignDetail(
  env: Env,
  nonce: string,
  session: Session,
  ruleId: string,
): Promise<Response> {
  const rule = await env.DB.prepare(
    `SELECT id, account_id, name, active, trigger_type, expires_at, require_follow,
            media_id, keywords, match_any, is_default
       FROM rules WHERE id = ?`,
  )
    .bind(ruleId)
    .first<RuleRow>();

  if (!rule) return new Response("Not found", { status: 404 });

  const counts = await env.DB.prepare(
    `SELECT COUNT(*)                                                          AS matched,
            COALESCE(SUM(CASE WHEN dm_sent_at IS NOT NULL THEN 1 END), 0)     AS sent,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 END), 0)          AS failed,
            COALESCE(SUM(CASE WHEN status = 'AWAITING_FOLLOW' THEN 1 END), 0) AS awaiting
       FROM send_log WHERE rule_id = ?`,
  )
    .bind(ruleId)
    .first<Counts>();

  const linkResult = await env.DB.prepare(
    `SELECT label, target_url, clicks FROM tracked_links
      WHERE rule_id = ? ORDER BY position`,
  )
    .bind(ruleId)
    .all<LinkRow>();

  const eventResult = await env.DB.prepare(
    `SELECT commenter_name, status, created_at FROM send_log
      WHERE rule_id = ? ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(ruleId)
    .all<EventRow>();

  const matched = counts?.matched ?? 0;
  const sent = counts?.sent ?? 0;
  const failed = counts?.failed ?? 0;
  const awaiting = counts?.awaiting ?? 0;
  const links = linkResult.results ?? [];
  const events = eventResult.results ?? [];
  const clicks = links.reduce((total, link) => total + link.clicks, 0);
  const delivered = matched - awaiting - failed;

  // Recomputed on every visit rather than stamped at save time, so it clears
  // itself the moment the other automation is paused or its keyword changed.
  const conflict = describeConflicts(await findConflicts(env, rule));

  const body = html`
    ${conflict ? notice("warn", conflict) : raw("")}

    <div class="card">
      <span class="overline">Overview</span>
      <div class="list-item">
        <div>
          <strong>${triggerLabel(rule.trigger_type)}</strong>
          <div class="small muted">
            ${
              events.length
                ? `Last fired ${ago(events[0]!.created_at)}`
                : "Has not fired yet"
            }
          </div>
        </div>
        ${statusChip(rule)}
      </div>
    </div>

    <div class="hero">
      <div class="top"><span class="k">Click-through rate</span></div>
      <div class="n">${rate(clicks, sent)}</div>
      ${
        sent === 0
          ? html`<div class="small muted mt-8">No messages sent yet.</div>`
          : html`<div class="rate"><i></i></div>
              <div class="ends">
                <span><b>${sent}</b> received a message</span>
                <span><b>${clicks}</b> tapped a link</span>
              </div>`
      }
    </div>

    <div class="stats">
      <div class="stat"><div class="k">Sent</div><div class="n">${sent}</div></div>
      <div class="stat"><div class="k">Link clicks</div><div class="n">${clicks}</div></div>
      <div class="stat"><div class="k">Matched</div><div class="n">${matched}</div></div>
      <div class="stat"><div class="k">Failed</div><div class="n">${failed}</div></div>
    </div>

    ${
      links.length === 0
        ? raw("")
        : html`<div class="card mt-24">
            <span class="overline">Button performance</span>
            ${links.map(
              (link) => html`<div class="list-item">
                <div>
                  <strong>${link.label || "Open link"}</strong>
                  <div class="small muted">${link.clicks} click${link.clicks === 1 ? "" : "s"}</div>
                </div>
                <span class="chip accent">${rate(link.clicks, sent)} CTR</span>
              </div>`,
            )}
            ${
              links.length === 1
                ? html`<p class="small muted">
                    Add a second button with different wording and this table
                    becomes a free A/B test.
                  </p>`
                : raw("")
            }
          </div>`
    }

    ${
      rule.require_follow
        ? html`<div class="card mt-24">
            <span class="overline">Follow gate</span>
            <div class="funnel">
              <div class="step"><div class="k">Matched</div><div class="n">${matched}</div></div>
              <span class="arr">${icon("chevron", 16)}</span>
              <div class="step"><div class="k">Opener</div><div class="n">${sent}</div></div>
              <span class="arr">${icon("chevron", 16)}</span>
              <div class="step"><div class="k">Waiting</div><div class="n">${awaiting}</div></div>
              <span class="arr">${icon("chevron", 16)}</span>
              <div class="step on"><div class="k">Got link</div><div class="n">${Math.max(0, delivered)}</div></div>
            </div>
            <p class="small muted mt-12">
              Anyone sitting in <strong>Waiting</strong> tapped nothing, or has not
              followed yet. A large number here means the gate is costing you more
              reach than it is winning you followers.
            </p>
          </div>`
        : raw("")
    }

    <div class="card mt-24">
      <span class="overline">Recent activity</span>
      ${
        events.length === 0
          ? html`<p class="small muted mt-0">
              Nothing yet. Comment one of this automation's keywords from another
              account to test it.
            </p>`
          : events.map(
              (event) => html`<div class="list-item">
                <div>
                  <strong>${event.commenter_name ? `@${event.commenter_name}` : "Someone"}</strong>
                  <div class="small muted">${ago(event.created_at)}</div>
                </div>
                ${eventChip(event.status)}
              </div>`,
            )
      }
      <p class="mt-12"><a class="small" href="/logs">View all activity</a></p>
    </div>

    <p class="mt-24"><a class="btn block" href="/campaigns/${rule.id}/edit">Edit automation</a></p>

    <div class="card danger mt-24">
      <span class="overline">Danger zone</span>
      <p class="small mt-0">
        Deleting this automation also deletes its delivery history and its click
        counts. This cannot be undone.
      </p>
      <form method="post" action="/campaigns/${rule.id}/delete">
        ${csrfField(session.csrf)}
        <div class="row">
          <input type="checkbox" id="sure" name="confirm" value="yes" required>
          <label for="sure" class="small">Yes, delete "${rule.name}" and its history.</label>
        </div>
        <button type="submit" class="block danger-solid">Delete automation</button>
      </form>
    </div>
  `;

  return new Response(
    layout(
      {
        title: rule.name,
        nonce,
        session: true,
        tab: "home",
        back: { href: "/", label: rule.name },
        style: `.hero .rate i{width:${ratePercent(clicks, sent)}%}`,
      },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
