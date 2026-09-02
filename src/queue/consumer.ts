/**
 * The send worker — the actual product.
 *
 * Everything else in this codebase is ordinary web application work. This file
 * is where the value is, and almost none of it is about sending. It is about
 * what surrounds the send:
 *
 *   - resuming a partially completed comment without repeating the leg that
 *     already landed
 *   - reserving capacity atomically rather than checking it
 *   - deferring, never dropping, when the hourly ceiling is reached
 *   - telling the three kinds of platform failure apart and answering each
 *     differently
 *   - halting an account, rather than a job, when the operator has a problem
 */

import type { Env, SendJob } from "../env";
import { classify, backoffFor } from "../lib/failures";
import { loadConfig } from "../lib/config";
import { pickVariant } from "../lib/matcher";
import { decryptToken } from "../lib/crypto";
import { reserveSendSlot, releaseSendSlot } from "../lib/security";
import { reserveSend, releaseSend } from "../lib/metering";
import {
  getSendLog,
  getRule,
  getAccount,
  linksForRule,
  updateSendLog,
  bumpAttempts,
  setAccountHealth,
  parseVariants,
  askForEmail,
  hasEmail,
} from "../lib/db";
import { randomId } from "../lib/crypto";
import {
  sendPrivateReply,
  sendDirectMessage,
  sendPublicReply,
  checkFollows,
  type MessageButton,
} from "../lib/instagram";

const MAX_REQUEUES = 3;

/**
 * Button payload prefixes.
 *
 * Both routes lead to the same handler. START is the opener's button — the tap
 * that creates a conversation and therefore consent. FOLLOW_CHECK is the gate's
 * "I'm following" button. From our side the required action is identical: look
 * at the follow status now that we are finally allowed to.
 */
export const START_PREFIX = "start:";
export const FOLLOW_CHECK_PREFIX = "followcheck:";

const DEFAULT_OPENER =
  "Hey {username}! Thanks for commenting. Tap below and I'll send it straight over.";
const DEFAULT_OPENER_BUTTON = "Show me more";
const DEFAULT_GATE_PROMPT =
  "Almost there! Follow the account, then tap below to unlock it.";

const DEFAULT_EMAIL_PROMPT = "What's the best email to send it to?";
const DEFAULT_EMAIL_THANKS = "Got it — here you go.";

export async function handleBatch(
  batch: MessageBatch<SendJob>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (message.body.kind === "COMMENT_REPLY") {
        await handleCommentReply(env, message.body.sendLogId, message.body.requeues ?? 0);
      } else if (message.body.kind === "FOLLOW_CHECK") {
        await handleFollowCheck(env, message.body.sendLogId);
      } else if (message.body.kind === "EMAIL_CAPTURED") {
        await handleEmailDelivery(env, message.body.sendLogId);
      } else if (message.body.kind === "EMAIL_ASK") {
        await handleEmailAsk(env, message.body.sendLogId);
      } else {
        await handleFollowUp(env, message.body.sendLogId);
      }
    } catch (error) {
      // Our taxonomy owns retries, so a throw here is a bug in our code rather
      // than a platform failure. Log it and acknowledge — a platform-level
      // retry would just re-run the same bug.
      console.error("[worker] unhandled error", error);
    }
    message.ack();
  }
}

async function handleCommentReply(
  env: Env,
  sendLogId: string,
  requeues: number,
): Promise<void> {
  const log = await getSendLog(env, sendLogId);
  if (!log) return;

  // Terminal states are terminal.
  if (log.status === "SENT" || log.status === "SKIPPED") return;
  if (log.failure_class === "PERMANENT_COMMENT" || log.failure_class === "PERMANENT_ACCOUNT") {
    return;
  }

  const rule = await getRule(env, log.rule_id);
  const account = await getAccount(env, log.account_id);
  if (!rule || !account) return;

  if (account.health !== "OK") {
    await park(env, log.id, "PERMANENT_ACCOUNT", "ACCOUNT_HALTED", `Account halted: ${account.health}`);
    return;
  }

  // Work out what is actually left. A comment produces up to two artifacts that
  // fail independently; a retry must only redo the missing one.
  const needsDm = !log.dm_sent_at;
  // A public reply only exists under a comment. There is nothing to reply
  // publicly to when the trigger was a message or a story.
  const needsPublic =
    rule.trigger_type === "COMMENT" &&
    rule.public_reply_enabled === 1 &&
    !log.public_reply_sent_at;
  if (!needsDm && !needsPublic) {
    await updateSendLog(env, log.id, { status: "SENT" });
    return;
  }

  const cfg = await loadConfig(env);
  const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);

  // Only a comment can be answered with a private reply — that call is
  // addressed to a comment id. A direct message or a story reply is already a
  // conversation, so those go out as ordinary messages to the person.
  const fromComment = rule.trigger_type === "COMMENT";

  const deliver = (text: string, buttons: MessageButton[] = []) =>
    fromComment
      ? sendPrivateReply(cfg, account.ig_user_id, token, log.comment_id, text, buttons)
      : sendDirectMessage(cfg, account.ig_user_id, token, log.commenter_id, text, buttons);

  // --- Follow gate -------------------------------------------------------
  // Fails open by design: when the platform will not tell us whether they
  // follow, we send. Stranding a real follower behind an API hiccup is much
  // worse than occasionally delivering to someone who has not followed.
  if (needsDm && rule.require_follow === 1) {
    // NO follow check here — it is not merely unreliable at this point, it is
    // impossible. The platform answers "User consent is required to access user
    // profile" for anyone who has not yet interacted with the account, and a
    // commenter by definition has not. Every pre-send check therefore failed
    // and fell open, which is why the gate appeared to do nothing at all.
    //
    // So the prompt always goes out first, and the follow is checked when they
    // tap the button — their tap IS the consent that makes the check possible.
    // This is why every tool in this category shows a prompt rather than
    // silently deciding up front.
    {
      // The OPENER, sent as the private reply — one short message whose only
      // job is to earn a tap. The follow gate cannot be shown yet: the platform
      // refuses to reveal follow status until a conversation exists, and a
      // comment does not create one.
      //
      // This consumes the single private reply the platform allows per comment,
      // so dm_sent_at is recorded. Everything afterwards is a direct message,
      // which their tap makes permissible.
      try {
        await deliver(
          personalise(rule.opener_message || DEFAULT_OPENER, log.commenter_name),
          [
            {
              label: rule.opener_button || DEFAULT_OPENER_BUTTON,
              payload: `${START_PREFIX}${log.id}`,
            },
          ],
        );
        await updateSendLog(env, log.id, {
          status: "AWAITING_FOLLOW",
          dm_sent_at: Math.floor(Date.now() / 1000),
          error_code: "AWAITING_FOLLOW",
        });
      } catch (error) {
        const verdict = classify(error as never);
        await onFailure(env, log.id, account.id, requeues, error, verdict);
      }
      return;
    }
  }

  // --- Capacity ----------------------------------------------------------
  let slotTaken = false;
  let meterPeriod: string | null = null;

  if (needsDm) {
    const slot = await reserveSendSlot(env, account.id);
    if (!slot.allowed) {
      if (requeues >= MAX_REQUEUES) {
        await park(env, log.id, "TRANSIENT", "RATE_CEILING", "Hourly ceiling; requeue limit reached");
        return;
      }
      // Deferred, not dropped. A late message is late; a dropped one is a
      // customer the operator never hears from.
      await env.SENDS.send(
        { kind: "COMMENT_REPLY", sendLogId: log.id, requeues: requeues + 1 },
        { delaySeconds: Math.min(slot.retryAfterSeconds + 30, 3600) },
      );
      return;
    }
    slotTaken = true;

    const meter = await reserveSend(env);
    meterPeriod = meter.period;
    if (!meter.allowed) {
      await releaseSendSlot(env, account.id);
      await park(env, log.id, "TRANSIENT", "MONTHLY_CAP", "Monthly send cap reached");
      return;
    }
  }

  // --- Private reply -----------------------------------------------------
  if (needsDm) {
    const links = await linksForRule(env, rule.id);
    const origin = cfg.origin;
    // Somebody who has already given their address is never asked again, on
    // either path. On BEFORE that also means the link is NOT held back from
    // them — otherwise a returning follower is blocked from the thing they
    // already paid for once, which is the worst possible way to treat the
    // people most engaged with the account.
    const known = rule.collect_email === 1
      ? await hasEmail(env, account.id, log.commenter_id)
      : false;

    // Only BEFORE holds the link back. On AFTER the link goes out now and the
    // question follows later, so this send is an ordinary one.
    const collecting =
      rule.collect_email === 1 && rule.email_timing !== "AFTER" && !known;

    // When collecting, the link is deliberately withheld. Handing over the link
    // and asking for the address in the same message means the link gets taken
    // and the address never given — the ask has to be the price, not a request
    // alongside something already free. The buttons come back in the thanks
    // message once the address arrives.
    const buttons: MessageButton[] = collecting
      ? []
      : links.map((link) => ({
          label: link.label ?? "Open",
          url: `${origin}/l/${link.slug}`,
        }));

    const body = collecting
      ? `${rule.message}

${rule.email_prompt || DEFAULT_EMAIL_PROMPT}`
      : rule.message;

    try {
      await deliver(personalise(body, log.commenter_name), buttons);
      await updateSendLog(env, log.id, {
        dm_sent_at: Math.floor(Date.now() / 1000),
        status: "PARTIAL",
        error_code: null,
      });
    } catch (error) {
      const verdict = classify(error as never);
      if (verdict.releaseReservation) {
        if (slotTaken) await releaseSendSlot(env, account.id);
        if (meterPeriod) await releaseSend(env, meterPeriod);
      }
      await onFailure(env, log.id, account.id, requeues, error, verdict);
      return;
    }
  }

  // --- Public reply ------------------------------------------------------
  // After the private reply and recorded separately: if this leg fails, the
  // retry sees dm_sent_at set and resumes straight here.
  if (needsPublic) {
    const variant = pickVariant(parseVariants(rule), log.comment_id);
    if (variant) {
      try {
        await sendPublicReply(cfg, log.comment_id, token, personalise(variant, log.commenter_name));
        await updateSendLog(env, log.id, {
          public_reply_sent_at: Math.floor(Date.now() / 1000),
        });
      } catch (error) {
        const verdict = classify(error as never);
        // The private reply already landed. Never fail the whole record over
        // the cosmetic leg — mark partial and let the ladder retry this alone.
        await onFailure(env, log.id, account.id, requeues, error, verdict, "PARTIAL");
        return;
      }
    }
  }

  await updateSendLog(env, log.id, {
    status: "SENT",
    failure_class: "NONE",
    error_code: null,
    error_message: null,
  });

  // Only now, once the message carrying the question has actually landed. A row
  // written before the send would leave someone marked as asked when nothing
  // reached them, and their next message would be read as an answer.
  if (rule.collect_email === 1 && needsDm && !(await hasEmail(env, account.id, log.commenter_id))) {
    if (rule.email_timing === "AFTER") {
      // The pending row is created by the ask itself, not here — on this path
      // the question has not been asked yet, and marking someone as asked
      // before asking would capture the next thing they happen to say.
      await env.SENDS.send(
        { kind: "EMAIL_ASK", sendLogId: log.id },
        { delaySeconds: Math.min(Math.max(rule.email_delay_mins ?? 10, 1), 720) * 60 },
      );
    } else {
      await askForEmail(env, {
        id: randomId(12),
        accountId: account.id,
        igUserId: log.commenter_id,
        username: log.commenter_name,
        ruleId: rule.id,
        sendLogId: log.id,
      });
    }
  }

  if (rule.follow_up_message && rule.follow_up_delay_mins) {
    await env.SENDS.send(
      { kind: "FOLLOW_UP", sendLogId: log.id },
      { delaySeconds: Math.min(rule.follow_up_delay_mins * 60, 43_200) },
    );
  }
}

/**
 * Someone tapped "I'm following". Re-check, then either deliver or re-prompt.
 *
 * Delivery here is a direct message, not a private reply: the one private reply
 * per comment was already spent on the prompt. Their tap reopened the messaging
 * window, which is what makes this permitted.
 *
 * Fails open, exactly as the first check does — if the platform will not
 * confirm the follow, send the link anyway. Someone who tapped the button has
 * done what was asked, and stranding a genuine follower over an ambiguous API
 * response is far worse than occasionally rewarding a stranger.
 */
async function handleFollowCheck(env: Env, sendLogId: string): Promise<void> {
  const log = await getSendLog(env, sendLogId);
  if (!log || log.status === "SENT") return;

  const rule = await getRule(env, log.rule_id);
  const account = await getAccount(env, log.account_id);
  if (!rule || !account || account.health !== "OK") return;

  const cfg = await loadConfig(env);
  const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);
  const follows = await checkFollows(cfg, token, log.commenter_id);

  if (follows === false) {
    // Only an explicit false re-prompts. A null — consent still missing, or any
    // other platform hiccup — delivers, because tapping the button is already a
    // stronger signal of intent than the API can give us.
    try {
      await sendDirectMessage(
        cfg,
        account.ig_user_id,
        token,
        log.commenter_id,
        personalise(rule.follow_gate_message || DEFAULT_GATE_PROMPT, log.commenter_name),
        [
          { label: "Follow", url: `https://instagram.com/${account.username}` },
          { label: "I'm following ✓", payload: `${FOLLOW_CHECK_PREFIX}${log.id}` },
        ],
      );
    } catch (error) {
      console.warn("[worker] re-prompt failed", error);
    }
    return;
  }

  const slot = await reserveSendSlot(env, account.id);
  if (!slot.allowed) {
    await env.SENDS.send({ kind: "FOLLOW_CHECK", sendLogId: log.id }, {
      delaySeconds: Math.min(slot.retryAfterSeconds + 30, 3600),
    });
    return;
  }

  const links = await linksForRule(env, rule.id);
  const buttons: MessageButton[] = links.map((link) => ({
    label: link.label ?? "Open",
    url: `${cfg.origin}/l/${link.slug}`,
  }));

  try {
    await sendDirectMessage(
      cfg,
      account.ig_user_id,
      token,
      log.commenter_id,
      personalise(rule.message, log.commenter_name),
      buttons,
    );
    await updateSendLog(env, log.id, {
      status: "SENT",
      failure_class: "NONE",
      error_code: null,
      error_message: null,
    });

    /*
     * Email capture on the gated path.
     *
     * This branch used to end here, so an automation with BOTH the follow gate
     * and email capture switched on silently collected nothing — two toggles
     * enabled in the editor, one quietly doing nothing at all.
     *
     * Always deferred here, whatever the rule's timing says. BEFORE means "the
     * link is the price of the address", but on this path the link is already
     * the reward for following; charging for it twice would be three hoops in a
     * row — follow, then hand over your email, then finally get the thing. The
     * editor says so rather than letting the setting appear to be ignored.
     *
     * Deferring is also reliable here in a way it is not after a bare comment:
     * their tap opened the messaging window, so the later question can actually
     * be delivered.
     */
    if (
      rule.collect_email === 1 &&
      !(await hasEmail(env, account.id, log.commenter_id))
    ) {
      await env.SENDS.send(
        { kind: "EMAIL_ASK", sendLogId: log.id },
        { delaySeconds: Math.min(Math.max(rule.email_delay_mins ?? 10, 1), 720) * 60 },
      );
    }
  } catch (error) {
    const verdict = classify(error as never);
    if (verdict.releaseReservation) await releaseSendSlot(env, account.id);
    await onFailure(env, log.id, account.id, 0, error, verdict);
  }
}

async function handleFollowUp(env: Env, sendLogId: string): Promise<void> {
  const log = await getSendLog(env, sendLogId);
  // Only follow up on a conversation that actually started.
  if (!log?.dm_sent_at) return;

  const rule = await getRule(env, log.rule_id);
  const account = await getAccount(env, log.account_id);
  if (!rule?.follow_up_message || !account || account.health !== "OK") return;

  // Follow-ups are best-effort and must never starve a first send.
  const slot = await reserveSendSlot(env, account.id);
  if (!slot.allowed) return;

  try {
    const cfg = await loadConfig(env);
    const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);

    // A direct message, NOT a private reply.
    //
    // This used to reply to the comment again. Instagram allows exactly one
    // private reply per comment and the first send already spent it, so every
    // follow-up on a comment automation was rejected with error 10900 —
    // "already replied" — and the feature had never worked at all.
    //
    // As a direct message it is best-effort instead: it lands when a messaging
    // window is open, which a DM or story reply creates and a comment does not.
    // Best-effort and honest beats guaranteed failure.
    await sendDirectMessage(
      cfg,
      account.ig_user_id,
      token,
      log.commenter_id,
      personalise(rule.follow_up_message, log.commenter_name),
    );
  } catch (error) {
    const verdict = classify(error as never);
    if (verdict.releaseReservation) await releaseSendSlot(env, account.id);
    console.warn(`[worker] follow-up not delivered: ${verdict.reason}`);
  }
}

async function onFailure(
  env: Env,
  sendLogId: string,
  accountId: string,
  requeues: number,
  error: unknown,
  verdict: ReturnType<typeof classify>,
  partialStatus: "FAILED" | "PARTIAL" = "FAILED",
): Promise<void> {
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code ?? null;

  if (verdict.class === "PERMANENT_ACCOUNT") {
    // One operator problem, not N job problems. Halting the account means the
    // dashboard shows a single actionable message instead of a wall of
    // identical failures.
    await setAccountHealth(env, accountId, "TOKEN_EXPIRED", verdict.reason);
    await park(env, sendLogId, verdict.class, code, `${verdict.reason}: ${raw}`);
    return;
  }

  if (verdict.class === "PERMANENT_COMMENT") {
    await park(env, sendLogId, verdict.class, code, `${verdict.reason}: ${raw}`);
    return;
  }

  const attempts = await bumpAttempts(env, sendLogId);
  const delayMs = backoffFor(attempts - 1);

  if (delayMs === null) {
    await park(env, sendLogId, "TRANSIENT", code, `Retries exhausted: ${raw}`);
    return;
  }

  if (!verdict.known) {
    // Loud on purpose. An unclassified code is a gap in the taxonomy, and the
    // taxonomy is the most valuable thing this system accumulates.
    console.warn(`[worker] unclassified platform error, retrying blind: ${raw}`);
  }

  await updateSendLog(env, sendLogId, {
    status: partialStatus,
    failure_class: "TRANSIENT",
    error_code: code,
    error_message: raw.slice(0, 500),
  });

  await env.SENDS.send(
    { kind: "COMMENT_REPLY", sendLogId, requeues },
    { delaySeconds: Math.floor(delayMs / 1000) },
  );
}

async function park(
  env: Env,
  sendLogId: string,
  failureClass: "TRANSIENT" | "PERMANENT_COMMENT" | "PERMANENT_ACCOUNT",
  errorCode: string | null,
  errorMessage: string,
): Promise<void> {
  await updateSendLog(env, sendLogId, {
    status: "FAILED",
    failure_class: failureClass,
    error_code: errorCode,
    error_message: errorMessage.slice(0, 500),
  });
}

/** `{username}` in a message body is replaced with the commenter's handle. */
function personalise(text: string, username: string | null): string {
  return text.replace(/\{username\}/g, username ?? "there");
}


/**
 * They answered with an address. Send the thanks, carrying the links.
 *
 * This is an ordinary direct message rather than a private reply: the one
 * private reply per comment was spent on the question, and their answer is what
 * opened the messaging window that makes this permitted.
 */
async function handleEmailDelivery(env: Env, sendLogId: string): Promise<void> {
  const log = await getSendLog(env, sendLogId);
  if (!log) return;

  const rule = await getRule(env, log.rule_id);
  const account = await getAccount(env, log.account_id);
  if (!rule || !account || account.health !== "OK") return;

  const cfg = await loadConfig(env);
  const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);
  const links = await linksForRule(env, rule.id);

  const buttons: MessageButton[] = links.map((link) => ({
    label: link.label ?? "Open",
    url: `${cfg.origin}/l/${link.slug}`,
  }));

  try {
    await sendDirectMessage(
      cfg,
      account.ig_user_id,
      token,
      log.commenter_id,
      personalise(rule.email_thanks || DEFAULT_EMAIL_THANKS, log.commenter_name),
      buttons,
    );
  } catch (error) {
    // The address is already stored, which is the part that cannot be redone.
    // A failed delivery here is logged and left alone rather than retried into
    // a loop — the operator can see it and message the person directly.
    console.error("[email] could not deliver after capture", sendLogId, error);
  }
}


/**
 * Ask for the address after the link has already been delivered.
 *
 * A direct message, deliberately — NOT a private reply. Instagram allows one
 * private reply per comment and that one was spent delivering the link, so a
 * second would be rejected outright.
 *
 * Which means this is best-effort on comment triggers: a comment does not open
 * a messaging window, so unless that person has since replied, Instagram will
 * refuse it. That is the cost of asking politely instead of gating, and the
 * editor says so rather than letting the operator discover it from the log.
 */
async function handleEmailAsk(env: Env, sendLogId: string): Promise<void> {
  const log = await getSendLog(env, sendLogId);
  if (!log?.dm_sent_at) return;

  const rule = await getRule(env, log.rule_id);
  const account = await getAccount(env, log.account_id);
  if (!rule || rule.collect_email !== 1 || !account || account.health !== "OK") return;

  // Checked again here, not just at enqueue time: they may have answered a
  // different automation during the delay.
  if (await hasEmail(env, account.id, log.commenter_id)) return;

  // Never let an optional ask starve a first send.
  const slot = await reserveSendSlot(env, account.id);
  if (!slot.allowed) return;

  try {
    const cfg = await loadConfig(env);
    const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);
    await sendDirectMessage(
      cfg,
      account.ig_user_id,
      token,
      log.commenter_id,
      personalise(rule.email_prompt || DEFAULT_EMAIL_PROMPT, log.commenter_name),
    );
  } catch (error) {
    const verdict = classify(error as never);
    if (verdict.releaseReservation) await releaseSendSlot(env, account.id);
    // Expected on comment triggers where the person never replied. Logged, not
    // retried — a closed window does not reopen on a second attempt.
    console.warn(`[worker] email ask not delivered: ${verdict.reason}`);
    return;
  }

  // Recorded only after the question actually landed, so an unanswerable ask
  // never leaves someone marked as pending.
  await askForEmail(env, {
    id: randomId(12),
    accountId: account.id,
    igUserId: log.commenter_id,
    username: log.commenter_name,
    ruleId: rule.id,
    sendLogId: log.id,
  });
}
