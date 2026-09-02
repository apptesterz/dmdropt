/**
 * Pulling an email address out of a direct message.
 *
 * People do not reply with a bare address. They reply "sure, it's
 * me@example.com thanks!", or with the address wrapped in punctuation, or with
 * a trailing full stop that is not part of it. So this extracts rather than
 * validates: find the address inside the sentence, or decide there isn't one.
 *
 * Deliberately conservative. A false positive stores rubbish in a list the
 * customer will later pay to email, and it also consumes the message — meaning
 * their real reply never reaches the automation that was waiting for it. A
 * false negative just means the message falls through to normal keyword
 * matching, which is the behaviour it would have had anyway.
 */

/**
 * One address, not RFC 5322.
 *
 * The full grammar permits quoted strings and comments that no human types into
 * a DM, and matching it would widen this to things that are not addresses. The
 * local part here allows the characters real providers actually issue; the
 * domain requires at least one dot and a two-letter-or-longer final label.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}/;

/** Length ceiling from RFC 5321: 64 for the local part, 255 overall. */
const MAX_LOCAL = 64;
const MAX_TOTAL = 254;

export function extractEmail(text: string): string | null {
  if (!text) return null;

  // People type addresses with a full-width @ on some mobile keyboards, and
  // paste them wrapped in angle brackets from a mail client.
  const normalised = text.replace(/＠/g, "@").replace(/[<>]/g, " ");

  const match = EMAIL.exec(normalised);
  if (!match) return null;

  // A trailing dot is nearly always sentence punctuation rather than part of
  // the address, and the pattern above cannot end on one anyway — but a
  // trailing hyphen can survive, so trim both.
  const candidate = match[0].replace(/[.\-]+$/, "").toLowerCase();

  if (candidate.length > MAX_TOTAL) return null;

  const at = candidate.lastIndexOf("@");
  if (at < 1) return null;

  const local = candidate.slice(0, at);
  const domain = candidate.slice(at + 1);

  if (local.length > MAX_LOCAL) return null;
  if (!domain.includes(".")) return null;
  // Consecutive dots are invalid on both sides and usually mean we have grabbed
  // the end of one sentence and the start of the next.
  if (candidate.includes("..")) return null;

  return candidate;
}
