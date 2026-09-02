/**
 * Platform failure taxonomy.
 *
 * A retry counter is not error handling. The platform returns many different
 * failures and they demand three different responses:
 *
 *   TRANSIENT          — throttling, timeouts, platform hiccups.
 *                        Retry on a widening ladder.
 *   PERMANENT_COMMENT  — this specific comment can never be answered: deleted,
 *                        messaging window closed, already replied, author
 *                        blocked us. Stop now. Retrying burns quota and looks
 *                        abusive to the platform.
 *   PERMANENT_ACCOUNT  — the operator has a problem: token expired or revoked,
 *                        permission withdrawn, account no longer professional.
 *                        Halt the whole account and surface it. Retrying
 *                        individual jobs buries an actionable problem under a
 *                        wall of failed sends.
 *
 * This mapping is DATA, not conditionals scattered through the worker. It grows
 * every time production teaches us something, and that accumulated knowledge is
 * the most valuable thing this codebase will ever own — it cannot be derived
 * from documentation, only from having been wrong in production.
 *
 * Unknown codes deliberately fall through to TRANSIENT with `known: false`, so
 * they appear in logs as unclassified rather than being silently swallowed.
 */

export type FailureClass =
  | "TRANSIENT"
  | "PERMANENT_COMMENT"
  | "PERMANENT_ACCOUNT";

export interface Classification {
  class: FailureClass;
  known: boolean;
  reason: string;
  /** True when the attempt did not consume platform quota, so a rate-limit
   *  reservation should be handed back rather than burned. */
  releaseReservation: boolean;
}

interface Rule {
  class: FailureClass;
  reason: string;
  releaseReservation: boolean;
}

/**
 * Keyed by the platform's numeric error code. Subcodes, where they matter, are
 * expressed as "code/subcode".
 */
const BY_CODE: Record<string, Rule> = {
  // --- Transient -----------------------------------------------------------
  "1": { class: "TRANSIENT", reason: "Unknown platform error", releaseReservation: true },
  "2": { class: "TRANSIENT", reason: "Platform temporarily unavailable", releaseReservation: true },
  "4": { class: "TRANSIENT", reason: "Application request limit reached", releaseReservation: true },
  "17": { class: "TRANSIENT", reason: "User request limit reached", releaseReservation: true },
  "32": { class: "TRANSIENT", reason: "Page request limit reached", releaseReservation: true },
  "613": { class: "TRANSIENT", reason: "Calls to this endpoint are throttled", releaseReservation: true },

  // --- Permanent for this comment -----------------------------------------
  "10": {
    class: "PERMANENT_COMMENT",
    reason: "Permission denied for this specific action",
    releaseReservation: false,
  },
  "100": {
    class: "PERMANENT_COMMENT",
    reason: "Invalid parameter — usually a deleted comment or an id we can no longer act on",
    releaseReservation: true,
  },
  "551": {
    class: "PERMANENT_COMMENT",
    reason: "Recipient cannot be messaged — blocked us, or restricted messaging",
    releaseReservation: false,
  },
  "10900": {
    class: "PERMANENT_COMMENT",
    reason: "A private reply was already sent for this comment",
    releaseReservation: false,
  },
  "10901": {
    class: "PERMANENT_COMMENT",
    reason: "Comment is no longer eligible for a private reply — window closed",
    releaseReservation: false,
  },
  "10903": {
    class: "PERMANENT_COMMENT",
    reason: "Cannot reply to our own comment",
    releaseReservation: true,
  },

  // --- Permanent for this account -----------------------------------------
  "102": {
    class: "PERMANENT_ACCOUNT",
    reason: "Session invalid — token expired or was revoked",
    releaseReservation: true,
  },
  "190": {
    class: "PERMANENT_ACCOUNT",
    reason: "Access token expired or invalidated",
    releaseReservation: true,
  },
  "200": {
    class: "PERMANENT_ACCOUNT",
    reason: "Required permission has not been granted",
    releaseReservation: true,
  },
  "230": {
    class: "PERMANENT_ACCOUNT",
    reason: "Messaging permission missing for this account",
    releaseReservation: true,
  },
};

/** Substring fallbacks for responses that arrive without a usable code. */
const BY_MESSAGE: Array<[RegExp, Rule]> = [
  [/rate limit|too many requests|please retry/i, { class: "TRANSIENT", reason: "Rate limited", releaseReservation: true }],
  [/timed? ?out|ETIMEDOUT|ECONNRESET|socket hang up/i, { class: "TRANSIENT", reason: "Network failure", releaseReservation: true }],
  [/already (been )?(sent|replied)/i, { class: "PERMANENT_COMMENT", reason: "Already answered", releaseReservation: false }],
  [/does not exist|deleted|not found/i, { class: "PERMANENT_COMMENT", reason: "Comment no longer exists", releaseReservation: true }],
  [/access token|oauth|session/i, { class: "PERMANENT_ACCOUNT", reason: "Credential problem", releaseReservation: true }],
];

export interface PlatformError {
  code?: string | number;
  subcode?: string | number;
  message?: string;
}

export function classify(error: PlatformError): Classification {
  const code = error.code === undefined ? null : String(error.code);
  const subcode = error.subcode === undefined ? null : String(error.subcode);

  if (code && subcode) {
    const rule = BY_CODE[`${code}/${subcode}`];
    if (rule) return { ...rule, known: true };
  }
  if (code) {
    const rule = BY_CODE[code];
    if (rule) return { ...rule, known: true };
  }

  const message = error.message ?? "";
  for (const [pattern, rule] of BY_MESSAGE) {
    if (pattern.test(message)) return { ...rule, known: true };
  }

  return {
    class: "TRANSIENT",
    known: false,
    reason: `Unclassified platform error${code ? ` (code ${code})` : ""}`,
    releaseReservation: true,
  };
}

/**
 * Widening retry ladder, in milliseconds. Three attempts then park.
 *
 * Deliberately measured in minutes rather than seconds: the failures worth
 * retrying here are rate ceilings and platform incidents, and neither clears in
 * under a second. Retrying fast against a throttle only deepens it.
 */
export const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000] as const;

export function backoffFor(attempt: number): number | null {
  return BACKOFF_MS[attempt] ?? null;
}
