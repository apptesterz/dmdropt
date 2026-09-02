/**
 * Two live automations that answer the same word.
 *
 * This is the single most expensive mistake a creator can make with this
 * product, because it does not look like a mistake. Both rules match, both
 * claim their own send, and the person who commented gets two DMs — which reads
 * as spam to them and as a bug to the operator, who then writes to support.
 *
 * It is not blocked, only reported. There are legitimate reasons to overlap
 * briefly, such as swapping one automation for another mid-campaign, and a hard
 * stop would be wrong. The job here is to make sure it is never a surprise.
 */

import type { Env } from "../env";
import { type RuleRow, parseKeywords } from "../lib/db";

export interface Conflict {
  ruleId: string;
  name: string;
  /** Words both rules answer to, or empty when both reply to everything. */
  shared: string[];
  /** True when the overlap is "reply to everything", not a specific word. */
  everything: boolean;
}

/**
 * Rules that would fire alongside this one.
 *
 * Only same-trigger rules can collide: a DM automation and a comment automation
 * listen on different events and never see each other's traffic. Within a
 * trigger, two rules overlap when they share a keyword, or when either replies
 * to everything — a match-any rule collides with every other rule on that
 * trigger by definition.
 *
 * Post scoping narrows comments: two rules on different specific posts cannot
 * both fire. A rule scoped to "any post" overlaps with all of them.
 */
/** Only the columns a collision depends on, so callers need not fetch the row. */
export type ConflictSubject = Pick<
  RuleRow,
  "id" | "account_id" | "trigger_type" | "media_id" | "keywords" | "match_any" | "is_default" | "active"
>;

export async function findConflicts(env: Env, rule: ConflictSubject): Promise<Conflict[]> {
  // A default reply only runs when nothing else matched, so it cannot collide
  // with anything by construction.
  if (rule.is_default === 1 || rule.active !== 1) return [];

  const result = await env.DB.prepare(
    `SELECT * FROM rules
      WHERE account_id = ? AND id != ? AND active = 1 AND is_default = 0
        AND trigger_type = ?
        AND (expires_at IS NULL OR expires_at > unixepoch())`,
  )
    .bind(rule.account_id, rule.id, rule.trigger_type)
    .all<RuleRow>();

  const mine = new Set(parseKeywords(rule).map((k) => k.toLowerCase()));
  const conflicts: Conflict[] = [];

  for (const other of result.results ?? []) {
    // Different specific posts never see the same comment.
    if (
      rule.trigger_type === "COMMENT" &&
      rule.media_id &&
      other.media_id &&
      rule.media_id !== other.media_id
    ) {
      continue;
    }

    // A story mention has no text, so every rule on that trigger fires on every
    // mention regardless of keywords.
    const bothEverything =
      rule.trigger_type === "STORY_MENTION" ||
      rule.match_any === 1 ||
      other.match_any === 1;

    if (bothEverything) {
      conflicts.push({ ruleId: other.id, name: other.name, shared: [], everything: true });
      continue;
    }

    const shared = parseKeywords(other)
      .filter((keyword) => mine.has(keyword.toLowerCase()))
      // Report the other rule's spelling; it is the one the operator will go
      // and look at.
      .slice(0, 8);

    if (shared.length) {
      conflicts.push({ ruleId: other.id, name: other.name, shared, everything: false });
    }
  }

  return conflicts;
}

/** One sentence an operator can act on, or null when there is nothing to say. */
export function describeConflicts(conflicts: Conflict[]): string | null {
  if (conflicts.length === 0) return null;

  const first = conflicts[0]!;
  const others = conflicts.length - 1;
  const alsoText = others > 0 ? ` (and ${others} other${others === 1 ? "" : "s"})` : "";

  if (first.everything) {
    return (
      `“${first.name}”${alsoText} replies to everything on this trigger, so both ` +
      `automations will fire and the same person will get two messages. Turn one off, ` +
      `or give each a different keyword.`
    );
  }

  const words = first.shared.join(", ");
  return (
    `“${first.name}”${alsoText} also answers to ${words}. Anyone who writes that gets ` +
    `two messages. Change the keyword on one of them, or pause the other.`
  );
}
