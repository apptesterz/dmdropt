/**
 * Instagram Graph API adapter — OAuth, media, comments, messaging.
 *
 * Everything that knows the platform's wire shape lives here, so the send logic
 * can be reasoned about and tested without a network.
 *
 * Official endpoints only. No scraping, no browser automation, no password
 * collection. That is a correctness requirement, not a preference: unofficial
 * routes get the operator's account restricted, which makes the product
 * worthless however well it otherwise works.
 */

import type { AppConfig } from "./config";

const AUTH_HOST = "https://www.instagram.com";
const API_HOST = "https://api.instagram.com";
const GRAPH_HOST = "https://graph.instagram.com";

/**
 * Business Login for Instagram — no Facebook Page required, which removes an
 * entire setup step for creators.
 */
export const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
] as const;

export class PlatformError extends Error {
  code?: string;
  subcode?: string;
  httpStatus: number;
  raw: string;

  constructor(httpStatus: number, raw: string, code?: string, subcode?: string, message?: string) {
    super(message ?? `Instagram API returned HTTP ${httpStatus}`);
    this.name = "PlatformError";
    this.httpStatus = httpStatus;
    this.raw = raw.slice(0, 2000);
    this.code = code;
    this.subcode = subcode;
  }
}

async function parseOrThrow(response: Response): Promise<unknown> {
  const text = await response.text();
  if (response.ok) return text ? JSON.parse(text) : {};

  let code: string | undefined;
  let subcode: string | undefined;
  let message: string | undefined;
  try {
    const body = JSON.parse(text) as {
      error?: { code?: number; error_subcode?: number; message?: string };
      error_message?: string;
    };
    code = body.error?.code === undefined ? undefined : String(body.error.code);
    subcode =
      body.error?.error_subcode === undefined ? undefined : String(body.error.error_subcode);
    message = body.error?.message ?? body.error_message;
  } catch {
    // Non-JSON body — keep the raw text so the taxonomy's message fallbacks can
    // still classify it.
  }
  throw new PlatformError(response.status, text, code, subcode, message);
}

async function graph<T>(
  cfg: AppConfig,
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${GRAPH_HOST}/${cfg.graphVersion}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return (await parseOrThrow(response)) as T;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizeUrl(cfg: AppConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    // Bound to the session and verified on return — without it, an attacker can
    // trick the operator into connecting an account the attacker controls.
    state,
  });
  return `${AUTH_HOST}/oauth/authorize?${params}`;
}

interface ShortLivedToken {
  access_token: string;
  user_id: number | string;
}

export async function exchangeCode(
  cfg: AppConfig,
  code: string,
  redirectUri: string,
): Promise<ShortLivedToken> {
  const response = await fetch(`${API_HOST}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return (await parseOrThrow(response)) as ShortLivedToken;
}

interface LongLivedToken {
  access_token: string;
  expires_in: number;
}

/** Short-lived tokens last an hour; long-lived ones last 60 days. Always upgrade. */
export async function exchangeForLongLived(
  cfg: AppConfig,
  shortLivedToken: string,
): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: cfg.appSecret,
    access_token: shortLivedToken,
  });
  const response = await fetch(`${GRAPH_HOST}/access_token?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  return (await parseOrThrow(response)) as LongLivedToken;
}

/**
 * Refresh a long-lived token. Run daily by cron.
 *
 * Daily rather than near expiry so an instance can be offline for weeks and
 * still recover on its own. A token that lapses means the operator has to
 * reconnect by hand, which at this price point is a support ticket.
 */
export async function refreshLongLived(token: string): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: token,
  });
  const response = await fetch(`${GRAPH_HOST}/refresh_access_token?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  return (await parseOrThrow(response)) as LongLivedToken;
}

// ---------------------------------------------------------------------------
// Account and media
// ---------------------------------------------------------------------------

export interface Profile {
  user_id: string;
  username: string;
  followers_count?: number;
  profile_picture_url?: string;
}

export async function getProfile(cfg: AppConfig, token: string): Promise<Profile> {
  return graph<Profile>(
    cfg,
    "/me?fields=user_id,username,followers_count,profile_picture_url",
    token,
  );
}

export interface Media {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

export async function listMedia(cfg: AppConfig, token: string, limit = 24): Promise<Media[]> {
  const result = await graph<{ data?: Media[] }>(
    cfg,
    `/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${limit}`,
    token,
  );
  return result.data ?? [];
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface LinkButton {
  label: string;
  url: string;
}

/**
 * A button that sends a payload BACK to us instead of opening a link.
 *
 * This is what makes an interactive flow possible — "I'm Following ✓", "Show me
 * more". Without it a message is a dead end, and a follow gate cannot exist:
 * there is no way for the person to tell us they have followed.
 *
 * Receiving these requires the `messages` webhook field to be subscribed, in
 * addition to `comments`.
 */
export interface PostbackButton {
  label: string;
  payload: string;
}

export type MessageButton = LinkButton | PostbackButton;

function toPlatformButton(button: MessageButton) {
  // Platform hard-limits button titles to 20 characters and silently rejects
  // the whole message if one is longer.
  const title = button.label.slice(0, 20);
  return "url" in button
    ? { type: "web_url", url: button.url, title }
    : { type: "postback", title, payload: button.payload };
}

function buildMessage(text: string, buttons: MessageButton[]) {
  const shown = buttons.slice(0, 3);
  const overflow = buttons.slice(3).filter((b): b is LinkButton => "url" in b);
  const body = overflow.length
    ? [text, "", ...overflow.map((b) => `${b.label}: ${b.url}`)].join("\n")
    : text;

  return shown.length
    ? {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: body,
            buttons: shown.map(toPlatformButton),
          },
        },
      }
    : { text: body };
}

/**
 * Send a normal direct message, addressed to a PERSON rather than a comment.
 *
 * Distinct from a private reply, which is addressed to a comment and may only
 * be used once per comment. Every message after that first one — the follow
 * prompt's answer, the unlocked link, follow-ups — must go through here, and is
 * only permitted inside the platform's 24-hour window, which the person's own
 * tap has just reopened.
 */
export async function sendDirectMessage(
  cfg: AppConfig,
  igUserId: string,
  token: string,
  recipientId: string,
  text: string,
  buttons: MessageButton[] = [],
): Promise<{ message_id?: string }> {
  return graph(cfg, `/${igUserId}/messages`, token, {
    method: "POST",
    body: { recipient: { id: recipientId }, message: buildMessage(text, buttons) },
  });
}

/**
 * Send a private reply to the author of a comment.
 *
 * Addressed to a COMMENT, not to a user, and the platform permits exactly one
 * per comment. That one-shot property is why the caller must be certain it has
 * not already sent — hence the uniqueness constraint on the send log.
 */
export async function sendPrivateReply(
  cfg: AppConfig,
  igUserId: string,
  token: string,
  commentId: string,
  text: string,
  buttons: MessageButton[] = [],
): Promise<{ message_id?: string }> {
  return graph(cfg, `/${igUserId}/messages`, token, {
    method: "POST",
    body: {
      recipient: { comment_id: commentId },
      message: buildMessage(text, buttons),
    },
  });
}

/** Post a visible reply underneath the comment. */
export async function sendPublicReply(
  cfg: AppConfig,
  commentId: string,
  token: string,
  message: string,
): Promise<{ id?: string }> {
  return graph(cfg, `/${commentId}/replies`, token, {
    method: "POST",
    body: { message },
  });
}

/**
 * Whether the commenter follows the connected account.
 *
 * Returns null when the platform does not say. Callers must treat null as
 * "send it anyway" — an ambiguous response must never strand a genuine
 * follower behind a gate. Over-delivering to a stranger is a rounding error;
 * failing a real customer is what people notice and complain about.
 */
export async function checkFollows(
  cfg: AppConfig,
  token: string,
  commenterId: string,
): Promise<boolean | null> {
  try {
    // Ask about the PERSON directly, by their Instagram-scoped id. An earlier
    // version called `/{account}/user_info?user_id=…`, which does not exist —
    // so every check threw, returned null, and the gate failed open on every
    // single send. It looked exactly like the feature doing nothing.
    const result = await graph<{ is_user_follow_business?: boolean }>(
      cfg,
      `/${encodeURIComponent(commenterId)}?fields=is_user_follow_business`,
      token,
    );

    if (typeof result.is_user_follow_business !== "boolean") {
      console.warn(
        `[follow] platform returned no follow status for ${commenterId} — failing open`,
      );
      return null;
    }
    return result.is_user_follow_business;
  } catch (error) {
    // Never silent. A gate that fails open without saying so is indis­tinguishable
    // from a gate that is switched off.
    console.warn(
      `[follow] check failed for ${commenterId}, failing open: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}
