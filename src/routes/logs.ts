/**
 * Delivery log.
 *
 * Laid out to the dmdrop Figma "Screens / Delivery Log" artboard: a filter row,
 * then one card per event carrying who, which automation, which door it came
 * through, the outcome and how long ago — then a pager.
 *
 * The design's "Opened" status is not implemented and cannot be: Instagram
 * reports no read receipts for private replies, to anyone. Everything shown
 * here is a state this product actually observes.
 *
 * Failures are shown in plain language, never as a platform error code. A
 * creator who reads "error 10901" writes to support; one who reads "this
 * comment was too old to reply to" does not. At this price point the log's job
 * is to prevent messages, not to satisfy a developer.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, icon } from "../lib/ui";

const PAGE_SIZE = 25;

interface LogRow {
  id: string;
  rule_name: string | null;
  commenter_name: string | null;
  matched_keyword: string | null;
  status: string;
  trigger_type: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
}

/** Platform error code, or our own marker, to something a person can act on. */
function humanise(row: LogRow): string {
  if (row.status === "SENT") return "Delivered";
  if (row.status === "PARTIAL") return "DM sent, public reply pending";
  if (row.status === "PENDING") return "Queued";
  if (row.status === "AWAITING_FOLLOW") return "Waiting for them to follow";

  const byCode: Record<string, string> = {
    RATE_CEILING: "Hourly Instagram limit reached — it will retry automatically",
    MONTHLY_CAP: "Monthly limit reached",
    ACCOUNT_HALTED: "Account is paused — reconnect Instagram",
    "10900": "Instagram had already replied to this comment",
    "10901": "This comment was too old to reply to",
    "10903": "This was your own comment",
    "551": "This person cannot receive DMs from you",
    "100": "The comment was deleted before we could reply",
    "190": "Instagram signed us out — reconnect",
    "102": "Instagram signed us out — reconnect",
    "200": "A required Instagram permission is missing",
    "230": "Messaging permission is missing for this account",
    "4": "Instagram was rate limiting — it will retry",
    "17": "Instagram was rate limiting — it will retry",
    "613": "Instagram was rate limiting — it will retry",
  };

  if (row.error_code && byCode[row.error_code]) return byCode[row.error_code]!;
  if (row.status === "FAILED") return "Could not deliver — see details below";
  return row.status;
}

/** Which door the request came through — useful when several rules are live. */
function triggerLabel(trigger: string | null): string {
  if (trigger === "DM") return "Via DM";
  if (trigger === "STORY_REPLY") return "Via story reply";
  if (trigger === "STORY_MENTION") return "Via story mention";
  return "Via comment";
}

function statusChip(status: string): string {
  if (status === "SENT") return "ok";
  if (status === "FAILED") return "bad";
  return "warn";
}

function ago(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Filters are whitelists mapped to fixed SQL, never interpolated values.
 *
 * The alternative — building a WHERE clause from the query string — is how a
 * read-only page becomes an injection point. Anything unrecognised falls back
 * to the default rather than erroring.
 */
const RANGES: Record<string, { label: string; seconds: number }> = {
  "1": { label: "Last 24 hours", seconds: 86400 },
  "7": { label: "Last 7 days", seconds: 7 * 86400 },
  "30": { label: "Last 30 days", seconds: 30 * 86400 },
  all: { label: "All time", seconds: 0 },
};

const STATUSES: Record<string, { label: string; sql: string }> = {
  all: { label: "All statuses", sql: "" },
  sent: { label: "Delivered", sql: "AND s.status = 'SENT'" },
  failed: { label: "Failed", sql: "AND s.status = 'FAILED'" },
  waiting: {
    label: "Waiting",
    sql: "AND s.status IN ('PENDING', 'PARTIAL', 'AWAITING_FOLLOW')",
  },
};

function select(
  name: string,
  chosen: string,
  options: Record<string, { label: string }>,
  label: string,
): string {
  const items = Object.entries(options)
    .map(
      ([value, option]) =>
        `<option value="${value}"${value === chosen ? " selected" : ""}>${option.label}</option>`,
    )
    .join("");
  return `<label for="f-${name}"><span class="overline">${label}</span>
    <select id="f-${name}" name="${name}">${items}</select></label>`;
}

export async function renderLogs(env: Env, request: Request, nonce: string): Promise<Response> {
  const query = new URL(request.url).searchParams;

  const range = RANGES[query.get("range") ?? ""] ? query.get("range")! : "7";
  const status = STATUSES[query.get("status") ?? ""] ? query.get("status")! : "all";
  const page = Math.max(1, Math.min(9999, Number(query.get("page")) || 1));

  const since = RANGES[range]!.seconds
    ? Math.floor(Date.now() / 1000) - RANGES[range]!.seconds
    : 0;
  const statusSql = STATUSES[status]!.sql;
  const where = `WHERE s.created_at >= ? ${statusSql}`;

  const counted = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM send_log s ${where}`,
  )
    .bind(since)
    .first<{ n: number }>();

  const total = counted?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);

  const result = await env.DB.prepare(
    `SELECT s.id, s.commenter_name, s.matched_keyword, s.status,
            s.error_code, s.error_message, s.created_at,
            r.name AS rule_name, r.trigger_type
       FROM send_log s
       LEFT JOIN rules r ON r.id = s.rule_id
       ${where}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(since, PAGE_SIZE, (current - 1) * PAGE_SIZE)
    .all<LogRow>();

  const rows = result.results ?? [];
  const pageUrl = (n: number) => `/logs?range=${range}&status=${status}&page=${n}`;

  const body = html`
    <form method="get" action="/logs" class="filters">
      ${raw(select("range", range, RANGES, "Period"))}
      ${raw(select("status", status, STATUSES, "Status"))}
      <button type="submit" class="secondary">Apply</button>
    </form>

    ${
      rows.length === 0
        ? html`<div class="empty card">
            <div class="icon">${icon("list", 22)}</div>
            <p class="mt-0">
              ${
                total === 0 && range === "7" && status === "all"
                  ? "Nothing yet. Comment one of your keywords on a post to test an automation."
                  : "No events match these filters."
              }
            </p>
          </div>`
        : rows.map(
            (row) => html`<div class="ev">
              <div class="grow">
                <div class="who">${row.commenter_name ? `@${row.commenter_name}` : "Someone"}</div>
                <div class="rule">${row.rule_name ?? "Deleted automation"}</div>
              </div>
              <div class="right">
                <span class="small muted">${triggerLabel(row.trigger_type)}</span>
                <span class="chip ${statusChip(row.status)}">${humanise(row)}</span>
                <span class="when">${ago(row.created_at)}</span>
              </div>
            </div>`,
          )
    }

    ${
      pages <= 1
        ? raw("")
        : html`<div class="pager">
            <a class="btn secondary ${current <= 1 ? "off" : ""}"
               href="${pageUrl(current - 1)}" aria-label="Previous page">${icon("left", 20)}</a>
            <span class="page">Page ${current} of ${pages}</span>
            <a class="btn secondary ${current >= pages ? "off" : ""}"
               href="${pageUrl(current + 1)}" aria-label="Next page">${icon("chevron", 20)}</a>
          </div>`
    }
  `;

  return new Response(
    layout(
      { title: "Activity", heading: "Delivery log", nonce, session: true, tab: "logs" },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
