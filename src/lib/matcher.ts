/**
 * Keyword matching against real Instagram comments.
 *
 * Real comments are not clean strings. They carry emoji, decorative
 * punctuation, mixed case, zero-width joiners, and every script on earth.
 *
 * The trap worth naming: JavaScript's `\w` and `\b` are ASCII-only. A "word
 * boundary" never fires between two Cyrillic characters, and `[^\w\s]` treats
 * every CJK character as punctuation to be stripped. Build a matcher on those
 * and a rule written in Russian or Japanese silently never fires — silently,
 * because nothing errors, no send is attempted, and no log row appears. Every
 * class here uses Unicode property escapes with the `u` flag instead.
 */

export type MatchMode = "WHOLE_WORD" | "SUBSTRING";

export interface MatchResult {
  matched: boolean;
  keyword: string | null;
}

/** Emoji, pictographs, flags, dingbats, variation selectors, ZWJ, keycaps. */
const PICTOGRAPHIC =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2B00}-\u{2BFF}]/gu;

/** Anything that is not a letter, digit, or whitespace — in any script. */
const NON_TEXT = /[^\p{L}\p{N}\s]/gu;

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Reduce a comment to comparable text: drop emoji, turn remaining punctuation
 * into spaces (so "link!" and "link" agree, and "buy-link" still yields "link"
 * as a whole word), collapse whitespace, lowercase.
 */
export function normalize(text: string): string {
  return text
    .replace(PICTOGRAPHIC, "")
    .replace(NON_TEXT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Test comment text against a rule's keywords. OR semantics — the first
 * keyword that matches wins and is returned, so the log records which trigger
 * actually fired rather than just that something did.
 */
export function matchKeywords(
  commentText: string,
  keywords: readonly string[],
  mode: MatchMode = "WHOLE_WORD",
): MatchResult {
  const haystack = normalize(commentText);
  if (!haystack || keywords.length === 0) {
    return { matched: false, keyword: null };
  }

  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (!needle) continue;

    if (mode === "SUBSTRING") {
      if (haystack.includes(needle)) return { matched: true, keyword };
      continue;
    }

    // Whole-word via lookarounds rather than \b: assert the match is not
    // flanked by a letter or digit of ANY script. This is what makes
    // "linking" fail to match "link" while "клод!" still matches "клод".
    const escaped = needle.replace(REGEX_METACHARACTERS, "\\$&");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(haystack)) return { matched: true, keyword };
  }

  return { matched: false, keyword: null };
}

/**
 * Deterministic variant selection for public replies.
 *
 * Posting an identical visible reply under every comment reads as automation
 * and invites platform scrutiny, so rules carry several variants. The choice is
 * derived from the comment id rather than randomised, so a retry of the same
 * comment reproduces the same reply instead of posting a second, different one.
 */
export function pickVariant<T>(variants: readonly T[], commentId: string): T | null {
  if (variants.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < commentId.length; i++) {
    hash = (hash * 31 + commentId.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(hash) % variants.length] ?? null;
}
