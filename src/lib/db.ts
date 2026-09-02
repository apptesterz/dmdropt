/**
 * D1 access.
 *
 * Every query in this file uses bound parameters. No string concatenation of
 * user input into SQL, anywhere, ever — D1's prepare/bind is the only route in.
 */

import type { Env } from "../env";

export interface AccountRow {
  id: string;
  ig_user_id: string;
  username: string;
  token_cipher: string;
  token_expires: number | null;
  health: "OK" | "TOKEN_EXPIRED" | "PERMISSION_REVOKED" | "NOT_PROFESSIONAL";
  health_note: string | null;
  created_at: number;
}

export interface RuleRow {
  id: string;
  account_id: string;
  name: string;
  media_id: string | null;
  keywords: string;
  match_mode: "WHOLE_WORD" | "SUBSTRING";
  match_any: number;
  trigger_type: "COMMENT" | "DM" | "STORY_REPLY" | "STORY_MENTION";
  message: string;
  public_reply_enabled: number;
  public_reply_variants: string;
  require_follow: number;
  follow_gate_message: string | null;
  opener_message: string | null;
  opener_button: string | null;
  follow_up_message: string | null;
  follow_up_delay_mins: number | null;
  active: number;
  /** Ask for an email address before handing over the link. */
  collect_email: number;
  email_prompt: string | null;
  email_thanks: string | null;
  /** BEFORE withholds the link until they answer; AFTER asks once it is sent. */
  email_timing: "BEFORE" | "AFTER";
  email_delay_mins: number | null;
  /** The catch-all. Fires only when nothing else matched. */
  is_default: number;
  /** Unix seconds. Past this the rule stops firing and shows as Expired. */
  expires_at: number | null;
  created_at: number;
}

export interface ContactRow {
  id: string;
  account_id: string;
  ig_user_id: string;
  username: string | null;
  email: string | null;
  rule_id: string | null;
  send_log_id: string | null;
  asked_at: number;
  captured_at: number | null;
}

export interface SendLogRow {
  id: string;
  rule_id: string;
  account_id: string;
  comment_id: string;
  commenter_id: string;
  commenter_name: string | null;
  matched_keyword: string | null;
  status: "PENDING" | "SENT" | "PARTIAL" | "FAILED" | "SKIPPED" | "AWAITING_FOLLOW";
  dm_sent_at: number | null;
  public_reply_sent_at: number | null;
  failure_class: "NONE" | "TRANSIENT" | "PERMANENT_COMMENT" | "PERMANENT_ACCOUNT";
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
}

export interface TrackedLinkRow {
  id: string;
  rule_id: string;
  slug: string;
  target_url: string;
  label: string | null;
  clicks: number;
  position: number;
}

export function parseKeywords(row: Pick<RuleRow, "keywords">): string[] {
  try {
    const parsed = JSON.parse(row.keywords);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function parseVariants(row: Pick<RuleRow, "public_reply_variants">): string[] {
  try {
    const parsed = JSON.parse(row.public_reply_variants);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
  )
    .bind(key, value)
    .run();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function listAccounts(env: Env): Promise<AccountRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM accounts ORDER BY created_at ASC",
  ).all<AccountRow>();
  return result.results ?? [];
}

export async function getAccount(env: Env, id: string): Promise<AccountRow | null> {
  return env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
}

export async function getAccountByIgId(env: Env, igUserId: string): Promise<AccountRow | null> {
  return env.DB.prepare("SELECT * FROM accounts WHERE ig_user_id = ?")
    .bind(igUserId)
    .first<AccountRow>();
}

export async function countAccounts(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setAccountHealth(
  env: Env,
  accountId: string,
  health: AccountRow["health"],
  note: string | null,
): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET health = ?, health_note = ? WHERE id = ?")
    .bind(health, note, accountId)
    .run();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function activeRulesForMedia(
  env: Env,
  accountId: string,
  mediaId: string | null,
): Promise<RuleRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM rules
     WHERE account_id = ? AND active = 1 AND trigger_type = 'COMMENT'
       AND is_default = 0
       AND (expires_at IS NULL OR expires_at > unixepoch())
       AND (media_id IS NULL OR media_id = ?)`,
  )
    .bind(accountId, mediaId ?? "")
    .all<RuleRow>();
  return result.results ?? [];
}

/**
 * Rules listening for a given trigger.
 *
 * Media scoping applies to comments only. A direct message is not attached to a
 * post, and stories expire within a day, so filtering either by media would just
 * mean the rule never fires.
 */
export async function activeRulesForTrigger(
  env: Env,
  accountId: string,
  triggerType: RuleRow["trigger_type"],
): Promise<RuleRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM rules
      WHERE account_id = ? AND active = 1 AND trigger_type = ?
        AND is_default = 0
        AND (expires_at IS NULL OR expires_at > unixepoch())`,
  )
    .bind(accountId, triggerType)
    .all<RuleRow>();
  return result.results ?? [];
}

export async function getRule(env: Env, id: string): Promise<RuleRow | null> {
  return env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RuleRow>();
}

export async function linksForRule(env: Env, ruleId: string): Promise<TrackedLinkRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM tracked_links WHERE rule_id = ? ORDER BY position ASC",
  )
    .bind(ruleId)
    .all<TrackedLinkRow>();
  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// Send log
// ---------------------------------------------------------------------------

export async function getSendLog(env: Env, id: string): Promise<SendLogRow | null> {
  return env.DB.prepare("SELECT * FROM send_log WHERE id = ?").bind(id).first<SendLogRow>();
}

/**
 * Claim a (rule, comment) pair.
 *
 * Returns null when the pair is already claimed. This is the idempotency
 * mechanism: the row is written BEFORE the platform is contacted, and the
 * unique constraint — not application logic — is what makes a duplicate send
 * impossible under webhook re-delivery, worker restarts, and overlapping
 * retries.
 */
export async function claimSend(
  env: Env,
  values: {
    id: string;
    ruleId: string;
    accountId: string;
    commentId: string;
    commenterId: string;
    commenterName: string | null;
    matchedKeyword: string | null;
  },
): Promise<string | null> {
  const result = await env.DB.prepare(
    `INSERT INTO send_log
       (id, rule_id, account_id, comment_id, commenter_id, commenter_name, matched_keyword, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
     ON CONFLICT (rule_id, comment_id) DO NOTHING
     RETURNING id`,
  )
    .bind(
      values.id,
      values.ruleId,
      values.accountId,
      values.commentId,
      values.commenterId,
      values.commenterName,
      values.matchedKeyword,
    )
    .first<{ id: string }>();

  return result?.id ?? null;
}

export async function updateSendLog(
  env: Env,
  id: string,
  fields: Partial<
    Pick<
      SendLogRow,
      | "status"
      | "dm_sent_at"
      | "public_reply_sent_at"
      | "failure_class"
      | "error_code"
      | "error_message"
      | "attempts"
    >
  >,
): Promise<void> {
  // The only place in this codebase where a SQL fragment is assembled rather
  // than fully literal, so the column names are checked against an explicit
  // allowlist at runtime. TypeScript already constrains callers; this makes the
  // guarantee hold even if a future caller passes an untyped object.
  const ALLOWED = new Set([
    "status",
    "dm_sent_at",
    "public_reply_sent_at",
    "failure_class",
    "error_code",
    "error_message",
    "attempts",
  ]);

  const columns = Object.keys(fields).filter((column) => ALLOWED.has(column));
  if (columns.length === 0) return;

  const assignments = columns.map((column) => `${column} = ?`).join(", ");
  await env.DB.prepare(
    `UPDATE send_log SET ${assignments}, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(...columns.map((column) => (fields as Record<string, unknown>)[column]), id)
    .run();
}

export async function bumpAttempts(env: Env, id: string): Promise<number> {
  const row = await env.DB.prepare(
    "UPDATE send_log SET attempts = attempts + 1, updated_at = unixepoch() WHERE id = ? RETURNING attempts",
  )
    .bind(id)
    .first<{ attempts: number }>();
  return row?.attempts ?? 1;
}

// ---------------------------------------------------------------------------
// Default reply
// ---------------------------------------------------------------------------

/**
 * The catch-all rule, if one is live.
 *
 * Deliberately not returned by activeRulesForTrigger: a default that competed
 * in ordinary matching would fire alongside every keyword rule and send two
 * messages for one comment. It is fetched only after matching has come up
 * empty, which is the single condition it exists for.
 */
export async function defaultRule(env: Env, accountId: string): Promise<RuleRow | null> {
  return env.DB.prepare(
    `SELECT * FROM rules
      WHERE account_id = ? AND active = 1 AND is_default = 1
        AND (expires_at IS NULL OR expires_at > unixepoch())`,
  )
    .bind(accountId)
    .first<RuleRow>();
}

/** Demote any other default. The partial unique index would reject a second. */
export async function clearOtherDefaults(
  env: Env,
  accountId: string,
  keepRuleId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE rules SET is_default = 0 WHERE account_id = ? AND is_default = 1 AND id != ?",
  )
    .bind(accountId, keepRuleId)
    .run();
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Record that we have asked this person for their address.
 *
 * Upsert rather than insert: someone who triggers two automations should be one
 * row in the export, not two. Re-asking resets the pending state so the next
 * address they send is captured against the automation that asked most
 * recently, while an address already captured is never overwritten by a later
 * ask that goes unanswered.
 */
export async function askForEmail(
  env: Env,
  fields: {
    id: string;
    accountId: string;
    igUserId: string;
    username: string | null;
    ruleId: string;
    sendLogId: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO contacts (id, account_id, ig_user_id, username, rule_id, send_log_id, asked_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT (account_id, ig_user_id) DO UPDATE SET
       username    = COALESCE(excluded.username, contacts.username),
       rule_id     = excluded.rule_id,
       send_log_id = excluded.send_log_id,
       asked_at    = excluded.asked_at`,
  )
    .bind(
      fields.id,
      fields.accountId,
      fields.igUserId,
      fields.username,
      fields.ruleId,
      fields.sendLogId,
    )
    .run();
}

/** A person we have asked but who has not answered yet. */
export async function pendingContact(
  env: Env,
  accountId: string,
  igUserId: string,
): Promise<ContactRow | null> {
  return env.DB.prepare(
    "SELECT * FROM contacts WHERE account_id = ? AND ig_user_id = ? AND email IS NULL",
  )
    .bind(accountId, igUserId)
    .first<ContactRow>();
}

/**
 * Store the address.
 *
 * Guarded on `email IS NULL` so a replayed webhook cannot overwrite a captured
 * address with a later message, and so the caller can tell a real capture from
 * a duplicate by whether a row changed.
 */
export async function captureEmail(
  env: Env,
  contactId: string,
  email: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE contacts SET email = ?, captured_at = unixepoch() WHERE id = ? AND email IS NULL",
  )
    .bind(email, contactId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listContacts(env: Env, limit = 500): Promise<ContactRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM contacts WHERE email IS NOT NULL
      ORDER BY captured_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<ContactRow>();
  return result.results ?? [];
}

export async function countContacts(env: Env): Promise<{ captured: number; asked: number }> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN email IS NOT NULL THEN 1 END), 0) AS captured,
            COUNT(*) AS asked
       FROM contacts`,
  ).first<{ captured: number; asked: number }>();
  return { captured: row?.captured ?? 0, asked: row?.asked ?? 0 };
}

/**
 * Has this person already given us their address?
 *
 * Asked before every capture decision. Someone who answered once must never be
 * asked again — and on the BEFORE path must never have the link held back from
 * them a second time, which would deny a returning follower the very thing they
 * already paid for with their address.
 */
export async function hasEmail(
  env: Env,
  accountId: string,
  igUserId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS found FROM contacts WHERE account_id = ? AND ig_user_id = ? AND email IS NOT NULL",
  )
    .bind(accountId, igUserId)
    .first<{ found: number }>();
  return Boolean(row);
}
