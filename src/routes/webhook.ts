/**
 * Webhook receiver — the web side's only job in the send path.
 *
 * Contract with the platform: acknowledge fast, always. Meta re-delivers
 * anything it does not get a prompt 200 for, so a slow handler manufactures the
 * duplicates the rest of the system then has to defend against.
 *
 * This route therefore does the cheapest possible thing: verify the signature,
 * match keywords, claim the comment, enqueue, return 200. It never calls the
 * platform.
 */

import type { Env } from "../env";
import { verifyWebhookSignature, timingSafeEqual, randomId } from "../lib/crypto";
import { loadConfig } from "../lib/config";
import { matchKeywords } from "../lib/matcher";
import { extractEmail } from "../lib/email";
import {
  getAccountByIgId,
  activeRulesForMedia,
  activeRulesForTrigger,
  claimSend,
  parseKeywords,
  getSendLog,
  pendingContact,
  captureEmail,
  defaultRule,
} from "../lib/db";
import { FOLLOW_CHECK_PREFIX, START_PREFIX } from "../queue/consumer";

/** Subscription handshake — Meta echoes our verify token once, at setup. */
export async function verifySubscription(env: Env, request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const config = await loadConfig(env, request);

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";

  // Constant-time: this token is a shared secret and a fast-failing compare
  // would leak it character by character.
  if (mode === "subscribe" && config.webhookVerifyToken && timingSafeEqual(token, config.webhookVerifyToken)) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Verification failed", { status: 403 });
}

interface CommentChange {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    media?: { id?: string };
    from?: { id?: string; username?: string };
  };
}

/**
 * Button taps arrive as `messaging` entries, not `changes`.
 *
 * Receiving these requires the `messages` webhook field to be subscribed in
 * addition to `comments`. Without it the follow gate can never complete — the
 * prompt goes out and the tap is never heard.
 */
interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  postback?: { payload?: string; title?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { story?: { id?: string; url?: string } };
    attachments?: Array<{ type?: string }>;
  };
}

/**
 * Which door did this arrive through?
 *
 * A direct message, a reply to a story, and a mention in someone's story are
 * all the same request — "send me the thing" — and each is a separate trigger
 * so the operator can word each one differently.
 */
function classifyMessage(event: MessagingEvent): "DM" | "STORY_REPLY" | "STORY_MENTION" | null {
  const message = event.message;
  if (!message || message.is_echo) return null;

  if (message.attachments?.some((a) => a.type === "story_mention")) return "STORY_MENTION";
  if (message.reply_to?.story) return "STORY_REPLY";
  if (typeof message.text === "string" && message.text.trim()) return "DM";
  return null;
}

interface WebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: CommentChange[];
    messaging?: MessagingEvent[];
  }>;
}

export async function receiveWebhook(env: Env, request: Request): Promise<Response> {
  const config = await loadConfig(env, request);

  // Raw bytes, not a parsed-then-restringified body: the signature is computed
  // over exactly these characters and JSON round-tripping changes them.
  const raw = await request.text();

  // Size guard before any parsing. An unbounded body is free CPU for an
  // attacker who has guessed the URL.
  if (raw.length > 512_000) return new Response("Payload too large", { status: 413 });

  if (!config.appSecret) return new Response("Not configured", { status: 503 });

  const signature = request.headers.get("x-hub-signature-256");
  if (!(await verifyWebhookSignature(raw, signature, config.appSecret))) {
    // Reject unsigned traffic outright. This endpoint is public, so without
    // this check anyone could forge comment events and burn the operator's
    // hourly send quota.
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    await processRaw(env, raw);
  } catch (error) {
    // Still acknowledge. A 500 earns a re-delivery of a payload we have most
    // likely already recorded, which is worse than dropping it: our own logs
    // show the failure, and Meta's retry cannot fix a bug in our code.
    console.error("[webhook] processing failed", error);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Parse and act on a verified payload.
 *
 * Exported because the same bytes arrive two ways — straight from Meta when the
 * customer runs their own app, and relayed by the broker when they took the
 * easy-connect path. Only the signature check differs between them; if the
 * processing diverged too, the most important logic in the product would exist
 * in two versions that drift.
 */
export async function processRaw(env: Env, raw: string): Promise<void> {
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    console.error("[webhook] unparseable payload");
    return;
  }
  await process(env, payload);
}

async function process(env: Env, payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;

    const account = await getAccountByIgId(env, entry.id);
    if (!account) continue;

    // A halted account keeps its jobs out of the queue entirely, rather than
    // queueing thousands of sends that will each fail identically.
    if (account.health !== "OK") continue;

    // A tap and a message can arrive in the same batch. If a tap was handled,
    // the message half is skipped so one interaction cannot start a second
    // automation on top of the flow already in progress.
    let handled = false;

    // --- Button taps ------------------------------------------------------
    for (const event of entry.messaging ?? []) {
      const payload = event.postback?.payload ?? event.message?.quick_reply?.payload;
      const senderId = event.sender?.id;
      // The opener's button and the gate's button both lead here. The first
      // tap is what creates consent; the second confirms the follow. The action
      // is the same either way — look at the follow status.
      const prefix = [START_PREFIX, FOLLOW_CHECK_PREFIX].find((p) => payload?.startsWith(p));
      if (!prefix || !payload || !senderId) continue;

      const sendLogId = payload.slice(prefix.length);
      const log = await getSendLog(env, sendLogId);

      // The payload names a send log, and the payload travels through the
      // user's device — so verify the tapper is the person that log belongs to.
      // Otherwise anyone who saw a payload could unlock someone else's link.
      if (!log || log.commenter_id !== senderId) continue;

      // Only a conversation actually waiting on a follow may be advanced,
      // which also makes a double-tap harmless.
      if (log.status !== "AWAITING_FOLLOW") continue;

      await env.SENDS.send({ kind: "FOLLOW_CHECK", sendLogId: log.id });
      handled = true;
    }

    // --- Messages, story replies, story mentions --------------------------
    for (const event of entry.messaging ?? []) {
      if (handled) break;

      const senderId = event.sender?.id;
      const messageId = event.message?.mid;
      const triggerType = classifyMessage(event);
      if (!senderId || !messageId || !triggerType) continue;

      // Ignore our own outgoing messages. Echoes arrive on the same channel and
      // would otherwise make every automation reply to itself, forever.
      if (senderId === account.ig_user_id) continue;

      const text = event.message?.text ?? "";

      // --- An answer to a question we asked ----------------------------
      // Checked before keyword matching, and only when this person is actually
      // waiting on one. Someone whose address is "guide@example.com" would
      // otherwise trip the GUIDE automation with their own reply, and the
      // automation that asked would keep waiting forever.
      if (triggerType === "DM") {
        const waiting = await pendingContact(env, account.id, senderId);
        if (waiting) {
          const email = extractEmail(text);
          if (email) {
            // Guarded on the row still being empty, so a re-delivered webhook
            // cannot enqueue a second thank-you message.
            const stored = await captureEmail(env, waiting.id, email);
            if (stored && waiting.send_log_id) {
              await env.SENDS.send({
                kind: "EMAIL_CAPTURED",
                sendLogId: waiting.send_log_id,
              });
            }
            handled = true;
            continue;
          }
          // Not an address. Fall through — their message may well be a keyword,
          // and swallowing it would leave them with no reply at all.
        }
      }

      const rules = await activeRulesForTrigger(env, account.id, triggerType);
      let matchedAny = false;

      for (const rule of rules) {
        // A story mention usually carries no text at all, so keyword matching
        // is meaningless there — being mentioned IS the trigger.
        const result =
          triggerType === "STORY_MENTION" || rule.match_any === 1
            ? { matched: true, keyword: null }
            : matchKeywords(text, parseKeywords(rule), rule.match_mode);

        if (!result.matched) continue;

        // The message id plays the part the comment id plays for comments: the
        // stable per-event key that makes a duplicate send impossible.
        const sendLogId = await claimSend(env, {
          id: randomId(12),
          ruleId: rule.id,
          accountId: account.id,
          commentId: messageId,
          commenterId: senderId,
          commenterName: null,
          matchedKeyword: result.keyword,
        });

        if (!sendLogId) continue;

        matchedAny = true;
        await env.SENDS.send({ kind: "COMMENT_REPLY", sendLogId });
      }

      // --- Default reply ------------------------------------------------
      // Last, and only on a clean miss. Fetched separately rather than being
      // one more candidate in the loop above, because a default that competed
      // with keyword rules would send a second message every single time one
      // of them matched.
      if (!matchedAny && triggerType === "DM") {
        const fallback = await defaultRule(env, account.id);
        if (fallback) {
          const sendLogId = await claimSend(env, {
            id: randomId(12),
            ruleId: fallback.id,
            accountId: account.id,
            commentId: messageId,
            commenterId: senderId,
            commenterName: null,
            matchedKeyword: null,
          });
          if (sendLogId) await env.SENDS.send({ kind: "COMMENT_REPLY", sendLogId });
        }
      }
    }

    // --- Comments ---------------------------------------------------------
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const comment = change.value;
      const commentId = comment?.id;
      const text = comment?.text;
      const commenterId = comment?.from?.id;
      const mediaId = comment?.media?.id ?? null;

      if (!commentId || !text || !commenterId) {
        console.log("[webhook] comment ignored: missing id, text or author");
        continue;
      }

      // Never message ourselves. The platform rejects it anyway, but the
      // attempt burns an hourly slot and fills the log with noise.
      if (commenterId === account.ig_user_id) {
        console.log("[webhook] comment ignored: it is our own");
        continue;
      }

      const rules = await activeRulesForMedia(env, account.id, mediaId);

      /*
       * Say why nothing happened.
       *
       * A dropped event used to leave no trace at all, which makes "I commented
       * and nothing came" unanswerable — for us and for a customer's own
       * support. The media id is the single most useful fact, because an
       * automation pinned to one post is the most common reason a comment on a
       * DIFFERENT post does nothing, and the id in Instagram's app is not
       * always the id the API reports.
       */
      if (rules.length === 0) {
        console.log(
          `[webhook] comment on media ${mediaId ?? "unknown"}: no active rule covers this post`,
        );
      }
      let claimed = 0;

      for (const rule of rules) {
        // A match-any rule replies to every comment on the media, so the
        // keyword test is skipped entirely rather than faked with a wildcard.
        const result =
          rule.match_any === 1
            ? { matched: true, keyword: null }
            : matchKeywords(text, parseKeywords(rule), rule.match_mode);

        if (!result.matched) continue;

        // Claim BEFORE any send is attempted. The unique constraint on
        // (rule, comment) is what makes a duplicate structurally impossible;
        // a null here means this pair is already claimed.
        const sendLogId = await claimSend(env, {
          id: randomId(12),
          ruleId: rule.id,
          accountId: account.id,
          commentId,
          commenterId,
          commenterName: comment?.from?.username ?? null,
          matchedKeyword: result.keyword,
        });

        if (!sendLogId) continue;

        claimed += 1;
        await env.SENDS.send({ kind: "COMMENT_REPLY", sendLogId });
      }

      if (rules.length > 0 && claimed === 0) {
        console.log(
          `[webhook] comment on media ${mediaId ?? "unknown"}: ` +
            `${rules.length} rule(s) cover this post but none matched the text`,
        );
      }
    }
  }
}
