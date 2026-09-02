/**
 * Automation editor.
 *
 * One screen, one automation. No flow canvas — creators build one simple rule
 * and never branch, so a drag-and-drop builder would be complexity charged to
 * the wrong person.
 *
 * The post picker is a thumbnail grid because nobody should ever be asked for a
 * media ID.
 */

import type { Env } from "../env";
import { html, raw, safeExternalUrl } from "../lib/html";
import { layout, csrfField, notice, toggle, icon } from "../lib/ui";
import { randomId, randomSlug, decryptToken } from "../lib/crypto";
import { loadConfig } from "../lib/config";
import {
  listAccounts,
  getRule,
  linksForRule,
  parseKeywords,
  parseVariants,
  clearOtherDefaults,
} from "../lib/db";
import { listMedia, type Media } from "../lib/instagram";
import { templateById } from "../lib/templates";
import type { Session } from "../lib/session";

// Meta's private-reply body limit is 1000 characters; keep a margin.
const MAX_MESSAGE = 900;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 60;
const MAX_VARIANTS = 5;

/**
 * The four doors a message can arrive through.
 *
 * Rendered as a chip row rather than a dropdown: four options, and on a phone a
 * row of chips shows all of them at once where a select hides three behind a
 * tap. Radios underneath, so it posts and reads correctly either way.
 */
const TRIGGERS: Array<[string, string]> = [
  ["COMMENT", "Comment"],
  ["DM", "DM"],
  ["STORY_REPLY", "Story reply"],
  ["STORY_MENTION", "Story mention"],
];

/**
 * Show "Which post?" only for comment triggers.
 *
 * A direct message is not attached to a post, and a story expires within a day
 * — pinning a rule to one story would leave it dead by tomorrow. So those
 * triggers apply to everything, and showing a picker for them implies a choice
 * that does not exist. That misled the first person who used it.
 *
 * Progressive enhancement only. Without this script both cards render, the
 * editor still works, and the server ignores media_id for non-comment triggers
 * anyway.
 */
const TRIGGER_SCRIPT = `
(function () {
  var group = document.getElementById('trigger');
  if (!group) return;

  var radios = group.querySelectorAll('input[name="trigger_type"]');
  var current = function () {
    for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
    return 'COMMENT';
  };

  var el = function (id) { return document.getElementById(id); };

  var COPY = {
    COMMENT: {
      noun: 'comment',
      hint: 'Fires when someone comments on your post. Pick which post below, or leave it on "Any post".',
      matchAny: 'Reply to <strong>every</strong> comment',
      matchAnyHint: 'No keyword needed. Everyone who comments gets the DM.',
      keywords: 'Separate with commas. A comment containing any of them triggers the DM.',
      note: 'Ignored when "reply to every comment" is on.'
    },
    DM: {
      noun: 'DM',
      hint: 'Fires when someone sends you a direct message.',
      matchAny: 'Reply to <strong>every</strong> DM',
      matchAnyHint: 'No keyword needed. Everyone who messages you gets the reply.',
      keywords: 'Separate with commas. A message containing any of them triggers the reply.',
      note: 'Ignored when "reply to every DM" is on.'
    },
    STORY_REPLY: {
      noun: 'story reply',
      hint: 'Fires when someone replies to one of your stories.',
      matchAny: 'Reply to <strong>every</strong> story reply',
      matchAnyHint: 'No keyword needed. Everyone who replies gets the DM. Use keywords instead if you run two stories at once.',
      keywords: 'Separate with commas. A story reply containing any of them triggers the DM. This is how you run two stories with different offers.',
      note: 'Ignored when "reply to every story reply" is on.'
    },
    STORY_MENTION: {
      noun: 'story mention',
      hint: 'Fires whenever someone mentions you in their story. There is no text to match, so keywords do not apply.',
      matchAny: '',
      matchAnyHint: '',
      keywords: '',
      note: ''
    }
  };

  var MEDIA_NOTE = {
    DM: 'Applies to any DM you receive.',
    STORY_REPLY: 'Applies to replies on all your stories. Stories expire, so there is nothing to pick — use keywords to tell two stories apart.',
    STORY_MENTION: 'Applies whenever anyone mentions you in their story.'
  };

  function set(id, value, asHtml) {
    var node = el(id);
    if (!node) return;
    if (asHtml) node.innerHTML = value; else node.textContent = value;
  }

  function sync() {
    var t = current();
    var copy = COPY[t] || COPY.COMMENT;
    var isComment = t === 'COMMENT';
    var usesKeywords = t !== 'STORY_MENTION';

    if (el('mediaCard')) el('mediaCard').hidden = !isComment;
    if (el('mediaNote')) el('mediaNote').hidden = isComment;
    set('mediaNoteText', MEDIA_NOTE[t] || '');

    set('triggerHint', copy.hint);
    set('matchAnyLabel', copy.matchAny, true);
    set('matchAnyHint', copy.matchAnyHint);
    set('keywordsHint', copy.keywords);
    set('keywordsNote', copy.note);

    // A story mention carries no text at all, so every keyword control is
    // meaningless there. Hiding them is clearer than leaving inputs that
    // silently do nothing.
    if (el('matchAnyRow')) el('matchAnyRow').hidden = !usesKeywords;
    if (el('keywordBlock')) el('keywordBlock').hidden = !usesKeywords;
    if (el('substringRow')) el('substringRow').hidden = !usesKeywords;

    // Only a DM has a "nothing matched" case worth answering. A comment arrives
    // on a specific post and a story mention carries no text, so neither can
    // miss in a way a catch-all would help with. The server enforces this too.
    if (el('defaultCard')) el('defaultCard').hidden = t !== 'DM';
  }

  for (var r = 0; r < radios.length; r++) radios[r].addEventListener('change', sync);
  sync();

  // Live keyword chips. The comma-separated field stays the source of truth, so
  // the form still works with this script disabled — the chips are a view of it
  // that a stray comma or a doubled word shows up in before saving rather than
  // after a campaign has run. Each chip can also delete its own word, which is
  // easier than editing a comma list on a phone.
  var kw = el('keywords');
  var kwPreview = el('kwPreview');
  if (kw && kwPreview) {
    var words = function () {
      return kw.value.split(',').map(function (w) { return w.trim(); })
               .filter(function (w) { return w.length; });
    };
    var renderKeywords = function () {
      var list = words();
      kwPreview.textContent = '';
      list.slice(0, 20).forEach(function (w, index) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = w + ' \\u00d7';
        chip.setAttribute('aria-label', 'Remove keyword ' + w);
        chip.addEventListener('click', function () {
          var next = words();
          next.splice(index, 1);
          kw.value = next.join(', ');
          renderKeywords();
        });
        kwPreview.appendChild(chip);
      });
    };
    kw.addEventListener('input', renderKeywords);
    renderKeywords();
  }

  // The delay is meaningless when the question gates the link, so it is hidden
  // rather than left on screen looking like a setting that does nothing.
  // Progressive enhancement: without this both are visible, which is harmless
  // because the server ignores the delay on the BEFORE path anyway.
  var timing = document.getElementById('emailTiming');
  if (timing) {
    var timingRadios = timing.querySelectorAll('input[name="email_timing"]');
    var syncTiming = function () {
      var after = false;
      for (var t = 0; t < timingRadios.length; t++) {
        if (timingRadios[t].checked && timingRadios[t].value === 'AFTER') after = true;
      }
      var block = el('emailDelayBlock');
      if (block) block.hidden = !after;
    };
    for (var t2 = 0; t2 < timingRadios.length; t2++) {
      timingRadios[t2].addEventListener('change', syncTiming);
    }
    syncTiming();
  }

  var msg = el('message');
  var count = el('msgCount');
  if (msg && count) {
    var renderCount = function () {
      count.textContent = msg.value.length + ' / ' + (msg.getAttribute('maxlength') || '900');
    };
    msg.addEventListener('input', renderCount);
    renderCount();
  }
})();
`;


/** "in 6 hours", "in 3 days", or "expired" — for the editor and dashboard. */
export function expiryLabel(expiresAt: number): string {
  const seconds = expiresAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "expired";
  if (seconds < 3600) return `in ${Math.ceil(seconds / 60)} min`;
  if (seconds < 86400) return `in ${Math.ceil(seconds / 3600)} hours`;
  return `in ${Math.ceil(seconds / 86400)} days`;
}

export async function renderEditor(
  env: Env,
  request: Request,
  nonce: string,
  session: Session,
  ruleId: string | null,
  error = "",
): Promise<Response> {
  const accounts = await listAccounts(env);
  if (accounts.length === 0) {
    return Response.redirect(new URL("/setup", request.url).toString(), 302);
  }

  const rule = ruleId ? await getRule(env, ruleId) : null;
  if (ruleId && !rule) return new Response("Not found", { status: 404 });

  const links = rule ? await linksForRule(env, rule.id) : [];

  /*
   * Which account this automation belongs to.
   *
   * An existing rule is pinned to the account that owns it and cannot be moved.
   * Its delivery history, tracked links and click counts are all recorded
   * against that pairing, so reassigning it would leave those pointing at an
   * account that never sent them. Previously this was `accounts[0]` in every
   * case, which meant editing a rule on a second account silently moved it to
   * the first one on save.
   *
   * For a NEW rule the choice comes from ?account= so the post grid below can
   * be fetched for the right account. That works without any scripting — the
   * picker is ordinary links.
   */
  const requested = new URL(request.url).searchParams.get("account");
  const account =
    (rule
      ? accounts.find((candidate) => candidate.id === rule.account_id)
      : accounts.find((candidate) => candidate.id === requested)) ?? accounts[0]!;

  // Media fetch is best-effort. A creator with an expired token should still be
  // able to edit the text of a rule rather than hitting a dead screen.
  let media: Media[] = [];
  try {
    const config = await loadConfig(env, request);
    const token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);
    media = await listMedia(config, token, 24);
  } catch {
    media = [];
  }

  // A template prefills the form and is then forgotten. It is never saved on
  // the creator's behalf — they read the wording and press the button, so
  // nothing goes live that they have not seen.
  const template = rule
    ? undefined
    : templateById(new URL(request.url).searchParams.get("template") ?? "");

  const keywords = rule ? parseKeywords(rule).join(", ") : (template?.keywords ?? "");
  const variants = rule
    ? parseVariants(rule)
    : template?.publicReplies
      ? template.publicReplies.split("\n")
      : [];

  /** Current value for a field: the saved rule, else the template, else blank. */
  const v = {
    name: rule?.name ?? template?.name ?? "",
    trigger: rule?.trigger_type ?? template?.trigger ?? "COMMENT",
    message: rule?.message ?? template?.message ?? "",
    matchAny: rule ? rule.match_any === 1 : Boolean(template?.matchAny),
    requireFollow: rule ? rule.require_follow === 1 : Boolean(template?.requireFollow),
    publicReply: rule ? rule.public_reply_enabled === 1 : Boolean(template?.publicReplies),
    collectEmail: rule ? rule.collect_email === 1 : Boolean(template?.collectEmail),
    emailPrompt: rule?.email_prompt ?? template?.emailPrompt ?? "",
    emailThanks: rule?.email_thanks ?? template?.emailThanks ?? "",
    emailTiming: rule?.email_timing ?? "BEFORE",
    emailDelay: rule?.email_delay_mins ?? "",
    isDefault: rule ? rule.is_default === 1 : false,
    followUp: rule?.follow_up_message ?? template?.followUp ?? "",
    followUpDelay: rule?.follow_up_delay_mins ?? template?.followUpDelayMins ?? "",
    linkLabel1: links[0]?.label ?? template?.buttonLabel ?? "",
  };

  const body = html`
    ${notice("bad", error)}
    <p class="small muted">
      Not sure what something does? <a href="/help">Read the short guide</a> —
      it opens in this app, nothing to download.
    </p>
    <form method="post" action="${rule ? `/campaigns/${rule.id}/edit` : "/campaigns/new"}">
      ${csrfField(session.csrf)}
      <input type="hidden" name="account_id" value="${account.id}">

      ${
        accounts.length < 2
          ? raw("")
          : rule
            ? html`<div class="card">
                <span class="overline">Instagram account</span>
                <div class="tile">
                  <span class="ic">${icon("insta", 20)}</span>
                  <div class="grow">
                    <div class="title">@${account.username}</div>
                    <div class="sub">
                      An automation stays with the account it was made for — its
                      delivery history and link clicks are recorded against it.
                      Make a new one to run this on another account.
                    </div>
                  </div>
                </div>
              </div>`
            : html`<div class="card">
                <span class="overline">Instagram account</span>
                <p class="small muted mt-0">Which account should this run on?</p>
                <div class="chips">
                  ${accounts.map(
                    (candidate) => html`<a class="acct ${
                      candidate.id === account.id ? "on" : ""
                    }" href="/campaigns/new?account=${candidate.id}${
                      template ? `&template=${template.id}` : ""
                    }">@${candidate.username}</a>`,
                  )}
                </div>
              </div>`
      }

      <div class="card">
        <span class="overline">Trigger</span>
        <label for="name">Name <span class="hint">Just for you.</span></label>
        <input type="text" id="name" name="name" required maxlength="80"
               value="${v.name}" placeholder="Free guide">

        <label>Trigger type</label>
        <div class="chips" id="trigger">
          ${TRIGGERS.map(
            ([value, label]) => html`<label>
              <input type="radio" name="trigger_type" value="${value}"
                     ${v.trigger === value ? raw("checked") : ""}>
              <span>${label}</span>
            </label>`,
          )}
        </div>
        <p class="hint" id="triggerHint"></p>

        <div id="keywordBlock">
        <label for="keywords">Keywords
          <span class="hint" id="keywordsHint"></span>
        </label>
        <input type="text" id="keywords" name="keywords"
               value="${keywords}" placeholder="LINK, GUIDE, SEND">
        <div class="kwpreview" id="kwPreview"></div>
        <p class="hint" id="keywordsNote"></p>

        </div>

        <div id="matchAnyRow">
          ${toggle({
            id: "matchAny",
            name: "match_any",
            title: raw('<span id="matchAnyLabel">Reply to <strong>every</strong> comment</span>'),
            sub: raw('<span id="matchAnyHint"></span>'),
            checked: v.matchAny,
          })}
        </div>

        <div id="substringRow">
          ${toggle({
            id: "substring",
            name: "substring",
            title: "Match inside longer words",
            sub: 'Off: "linking" will not trigger "link".',
            checked: rule?.match_mode === "SUBSTRING",
          })}
        </div>
      </div>

      <div class="card" id="mediaCard">
        <span class="overline">Which post?</span>
        ${
          media.length === 0
            ? html`<p class="small muted">
                Could not load your posts right now. This automation will apply to
                comments on any of your posts.
              </p>`
            : html`
                <div class="row">
                  <input type="radio" id="m-any" name="media_id" value=""
                         ${!rule?.media_id ? raw("checked") : ""}>
                  <label for="m-any">Any post</label>
                </div>
                <div class="grid-media mt-10">
                  ${media.map(
                    (item) => html`<label>
                      <input type="radio" name="media_id" value="${item.id}"
                             ${rule?.media_id === item.id ? raw("checked") : ""}>
                      <img src="${item.thumbnail_url ?? item.media_url ?? ""}"
                           alt="${(item.caption ?? "Post").slice(0, 60)}" loading="lazy">
                    </label>`,
                  )}
                </div>
              `
        }
      </div>

      <div class="card" id="mediaNote">
        <p class="small muted mt-0" id="mediaNoteText"></p>
      </div>

      <div class="card">
        <span class="overline">The message</span>
        <label for="message">The DM
          <span class="hint">Use {username} to greet them by name. ${MAX_MESSAGE} characters max.</span>
        </label>
        <textarea id="message" name="message" required maxlength="${MAX_MESSAGE}"
                  placeholder="Hey {username}! Here's the guide I promised 👇"
                  >${v.message}</textarea>
        <div class="counter" id="msgCount"></div>

        <label for="link1">Button link <span class="hint">Optional. Clicks are tracked.</span></label>
        <input type="url" id="link1" name="link_url_1" placeholder="https://..."
               value="${links[0]?.target_url ?? ""}">
        <input type="text" name="link_label_1" maxlength="20" placeholder="Button text (e.g. Get the guide)"
               value="${v.linkLabel1}" class="mt-8">
        ${
          links[0]
            ? html`<div class="row">
                <input type="checkbox" id="rm1" name="link_remove_1">
                <label for="rm1" class="small muted">
                  Remove this link (${links[0].clicks} click${links[0].clicks === 1 ? "" : "s"} recorded)
                </label>
              </div>`
            : ""
        }

        <label for="link2">Second button <span class="hint">Optional. Instagram allows two.</span></label>
        <input type="url" id="link2" name="link_url_2" placeholder="https://..."
               value="${links[1]?.target_url ?? ""}">
        <input type="text" name="link_label_2" maxlength="20" placeholder="Button text"
               value="${links[1]?.label ?? ""}" class="mt-8">
        ${
          links[1]
            ? html`<div class="row">
                <input type="checkbox" id="rm2" name="link_remove_2">
                <label for="rm2" class="small muted">
                  Remove this link (${links[1].clicks} click${links[1].clicks === 1 ? "" : "s"} recorded)
                </label>
              </div>`
            : ""
        }
      </div>

      <div class="card" id="defaultCard">
        <span class="overline">Default reply</span>
        ${toggle({
          id: "isDefault",
          name: "is_default",
          title: "Use this as the default reply",
          sub: raw(
            "Answers any DM that matches none of your other automations, so nobody " +
            "is met with silence. Only one automation can be the default, and it " +
            "never fires alongside a keyword match.",
          ),
          checked: v.isDefault,
        })}
      </div>

      <div class="card">
        <span class="overline">Public reply</span>
        ${toggle({
          id: "publicReply",
          name: "public_reply",
          title: "Also reply publicly under the comment",
          sub: "Shows other people that commenting actually works.",
          checked: v.publicReply,
        })}
        <label for="variants">Public replies
          <span class="hint">
            One per line. We rotate them — identical replies under every comment
            look automated and attract attention you do not want.
          </span>
        </label>
        <textarea id="variants" name="variants" placeholder="Sent! 💌&#10;Check your DMs 👀&#10;On its way!"
                  >${variants.join("\n")}</textarea>
      </div>

      <div class="card">
        <span class="overline">Follow gate</span>
        ${toggle({
          id: "requireFollow",
          name: "require_follow",
          title: "Require a follow first",
          sub: raw(
            "Grows followers, costs clicks. Watch your CTR before and after. " +
              "If Instagram will not confirm the follow, we send the link anyway.",
          ),
          checked: v.requireFollow,
        })}

        <label for="openerMsg">First message
          <span class="hint">
            Sent the moment they comment, with one button. Its job is to earn a
            tap — Instagram will not reveal whether someone follows you until a
            conversation exists, and a comment does not create one.
          </span>
        </label>
        <textarea id="openerMsg" name="opener_message" maxlength="${MAX_MESSAGE}"
                  placeholder="Hey {username}! Thanks for commenting. Tap below and I'll send it over."
                  >${rule?.opener_message ?? ""}</textarea>
        <input type="text" name="opener_button" maxlength="20" class="mt-8"
               placeholder="Button text (e.g. Show me more)"
               value="${rule?.opener_button ?? ""}">

        <label for="gateMsg">Second message — the follow gate
          <span class="hint">
            Sent after they tap, and only if they do not follow yet. Comes with a
            "Follow" button and an "I'm following" button. Leave blank for the
            default wording.
          </span>
        </label>
        <textarea id="gateMsg" name="follow_gate_message" maxlength="${MAX_MESSAGE}"
                  placeholder="Hey {username}! Follow first, then tap below and I'll send the link."
                  >${rule?.follow_gate_message ?? ""}</textarea>

        <label for="followUp">Follow-up message <span class="hint">Optional.</span></label>
        <textarea id="followUp" name="follow_up_message" maxlength="${MAX_MESSAGE}"
                  >${v.followUp}</textarea>
        <label for="delay">Send it after (minutes)</label>
        <input type="number" id="delay" name="follow_up_delay_mins" min="1" max="720"
               value="${v.followUpDelay}">
        <p class="under">
          On a <strong>comment</strong> automation this only arrives if that
          person has replied to you in the meantime — Instagram allows one reply
          to a comment and the first message used it. Dependable on DM and
          story-reply automations.
        </p>
      </div>

      <div class="card" id="emailCard">
        <span class="overline">Email capture</span>
        ${toggle({
          id: "collectEmail",
          name: "collect_email",
          title: "Ask for an email before sending the link",
          sub: raw(
            "For running a newsletter or anything else you send by email. A follower " +
            "is rented from Instagram; an address is owned, and it survives an " +
            "algorithm change or a lost account.",
          ),
          checked: v.collectEmail,
        })}

        <label>When to ask</label>
        <div class="chips" id="emailTiming">
          <label>
            <input type="radio" name="email_timing" value="BEFORE"
                   ${v.emailTiming !== "AFTER" ? raw("checked") : ""}>
            <span>Before the link</span>
          </label>
          <label>
            <input type="radio" name="email_timing" value="AFTER"
                   ${v.emailTiming === "AFTER" ? raw("checked") : ""}>
            <span>After the link</span>
          </label>
        </div>
        <p class="under">
          <strong>Before</strong> is how you build a mailing list. The link is the
          price of the address, which is the whole reason a lead magnet works —
          expect most people to pay it. Choose this if the point is the list.
        </p>
        <p class="under">
          <strong>After</strong> gets you goodwill, not a list. They already have
          what they came for, so answering is a favour and most will not. Choose
          this when you would rather not put a wall in front of a stranger.
        </p>

        <div id="emailDelayBlock">
          <label for="emailDelay">Ask this many minutes later
            <span class="hint">Default 10.</span>
          </label>
          <input type="number" id="emailDelay" name="email_delay_mins" min="1" max="720"
                 value="${v.emailDelay}">
          <p class="under">
            On a <strong>comment</strong> automation the later question only
            arrives if that person has replied to you in the meantime — Instagram
            does not let us message someone just because they commented. It is
            dependable on DM and story-reply automations.
          </p>
        </div>

        <label for="emailPrompt">The question
          <span class="hint">Sent on its own when asking after; added to your message when asking before.</span>
        </label>
        <input type="text" id="emailPrompt" name="email_prompt" maxlength="200"
               placeholder="What's the best email to send it to?"
               value="${v.emailPrompt}">

        <label for="emailThanks">After they answer
          <span class="hint">This message carries your link buttons.</span>
        </label>
        <input type="text" id="emailThanks" name="email_thanks" maxlength="200"
               placeholder="Got it — here you go."
               value="${v.emailThanks}">

        <p class="small muted">
          Addresses appear under <a href="/contacts">Contacts</a>, where you can
          download them as a spreadsheet.
        </p>
        <p class="under">
          With the <strong>follow gate</strong> also switched on, the question is
          always asked afterwards whatever you choose above — the link is already
          what they get for following, and asking them to pay for it twice would
          be three hoops in a row.
        </p>
      </div>

      <div class="card">
        <span class="overline">Lifespan</span>
        <label for="expiry">Stop automatically</label>
        <select id="expiry" name="expires_in">
          <option value="keep" selected>${
            rule?.expires_at
              ? `Keep current (${expiryLabel(rule.expires_at)})`
              : "Never — keep running"
          }</option>
          <option value="never">Never — keep running</option>
          <option value="1">In 1 day</option>
          <option value="3">In 3 days</option>
          <option value="7">In 7 days</option>
          <option value="30">In 30 days</option>
        </select>
        <p class="hint">
          For a story, 1 day matches how long the story lives. The automation
          stops on its own instead of sitting there months later still sending
          an old link.
        </p>

        ${toggle({
          id: "active",
          name: "active",
          title: "Active",
          sub: "Turn this off to stop it sending without deleting it.",
          checked: !rule || Boolean(rule.active),
        })}
      </div>

      <div class="form-actions">
        <button type="submit" class="block">${rule ? "Save changes" : "Create automation"}</button>
        <a class="out" href="${rule ? `/campaigns/${rule.id}` : "/"}">Cancel</a>
      </div>
    </form>

  `;

  return new Response(
    layout(
      {
        title: rule ? "Edit automation" : "New automation",
        nonce,
        session: true,
        tab: "home",
        back: rule
          ? { href: `/campaigns/${rule.id}`, label: rule.name }
          : { href: "/", label: "Dashboard" },
        script: TRIGGER_SCRIPT,
      },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  ruleId?: string;
}

/**
 * Validate and persist.
 *
 * Everything here arrives from a form and is treated as hostile: lengths are
 * capped, counts are capped, and URLs must survive `safeExternalUrl` — without
 * that check a `javascript:` destination would become stored XSS for anyone
 * clicking through from a DM.
 */
export async function saveRule(
  env: Env,
  form: FormData,
  ruleId: string | null,
): Promise<SaveResult> {
  /*
   * An edit can never move a rule to a different account.
   *
   * The form carries an account_id, but on an edit the stored one wins. The
   * rule's delivery history, tracked links and click counts are all recorded
   * against the original pairing, so honouring a changed value would leave
   * those attributed to an account that never sent them — and a crafted form
   * could reassign someone else's rule.
   */
  const existingRule = ruleId ? await getRule(env, ruleId) : null;
  const accountId = existingRule
    ? existingRule.account_id
    : String(form.get("account_id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const message = String(form.get("message") ?? "").trim();
  const rawKeywords = String(form.get("keywords") ?? "");

  if (!name) return { ok: false, error: "Give the automation a name." };
  if (!message) return { ok: false, error: "The DM cannot be empty." };
  if (message.length > MAX_MESSAGE) {
    return { ok: false, error: `The DM is too long (max ${MAX_MESSAGE} characters).` };
  }

  const keywords = rawKeywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS)
    .map((keyword) => keyword.slice(0, MAX_KEYWORD_LENGTH));

  const matchAny = form.get("match_any") ? 1 : 0;

  // Keywords stay mandatory unless replying to everything was chosen
  // explicitly, so a rule can never end up messaging every commenter by
  // accident. Checked below, once the trigger type is known.

  // The account must exist in this instance. Without this check a crafted form
  // could attach a rule to an arbitrary id.
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ id: string }>();
  if (!account) return { ok: false, error: "Unknown Instagram account." };

  const variants = String(form.get("variants") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_VARIANTS)
    .map((line) => line.slice(0, MAX_MESSAGE));

  const triggerRaw = String(form.get("trigger_type") ?? "COMMENT");
  const TRIGGERS = ["COMMENT", "DM", "STORY_REPLY", "STORY_MENTION"] as const;
  const triggerType = (TRIGGERS as readonly string[]).includes(triggerRaw)
    ? triggerRaw
    : "COMMENT";

  // A story mention has no text to match on, so it never needs keywords.
  if (triggerType !== "STORY_MENTION" && !matchAny && keywords.length === 0) {
    return { ok: false, error: "Add at least one keyword, or tick \"reply to every comment\"." };
  }

  // Only comments can be scoped to a post. Storing a media id for any other
  // trigger would be a value that silently never matches.
  const mediaId =
    triggerType === "COMMENT" ? String(form.get("media_id") ?? "").trim() || null : null;
  if (mediaId && !/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) {
    return { ok: false, error: "That post could not be selected. Try again." };
  }

  const delayRaw = Number.parseInt(String(form.get("follow_up_delay_mins") ?? ""), 10);
  const followUpDelay = Number.isFinite(delayRaw)
    ? Math.min(Math.max(delayRaw, 1), 720)
    : null;
  const openerMessage =
    String(form.get("opener_message") ?? "").trim().slice(0, MAX_MESSAGE) || null;
  const openerButton = String(form.get("opener_button") ?? "").trim().slice(0, 20) || null;
  const followGateMessage =
    String(form.get("follow_gate_message") ?? "").trim().slice(0, MAX_MESSAGE) || null;
  const followUpMessage =
    String(form.get("follow_up_message") ?? "").trim().slice(0, MAX_MESSAGE) || null;
  const collectEmail = form.get("collect_email") ? 1 : 0;
  const emailPrompt =
    String(form.get("email_prompt") ?? "").trim().slice(0, MAX_MESSAGE) || null;
  const emailThanks =
    String(form.get("email_thanks") ?? "").trim().slice(0, MAX_MESSAGE) || null;
  const emailTiming = form.get("email_timing") === "AFTER" ? "AFTER" : "BEFORE";
  const emailDelayRaw = Number.parseInt(String(form.get("email_delay_mins") ?? ""), 10);
  const emailDelay = Number.isFinite(emailDelayRaw)
    ? Math.min(Math.max(emailDelayRaw, 1), 720)
    : null;

  // The catch-all only makes sense on the one trigger that can miss. A comment
  // arrives on a specific post and a story mention carries no text at all, so
  // neither has a "nothing matched" case worth answering.
  const isDefault = form.get("is_default") && triggerType === "DM" ? 1 : 0;

  // A default that also required a follow would gate the very first thing a
  // stranger ever hears back, which reads as hostile rather than as a gate.
  if (isDefault && form.get("require_follow")) {
    return { ok: false, error: "A default reply cannot also require a follow." };
  }

  // "keep" leaves an existing expiry untouched, so editing the wording of a
  // rule does not silently restart or clear its clock.
  const expiresInRaw = String(form.get("expires_in") ?? "keep");
  let expiresAt: number | null | undefined;
  if (expiresInRaw === "never") expiresAt = null;
  else if (expiresInRaw !== "keep") {
    const days = Number.parseInt(expiresInRaw, 10);
    expiresAt = Number.isFinite(days)
      ? Math.floor(Date.now() / 1000) + Math.min(Math.max(days, 1), 365) * 86400
      : null;
  }

  const id = ruleId ?? randomId(12);
  const values = [
    name,
    mediaId,
    JSON.stringify(keywords),
    form.get("substring") ? "SUBSTRING" : "WHOLE_WORD",
    matchAny,
    triggerType,
    message,
    form.get("public_reply") ? 1 : 0,
    JSON.stringify(variants),
    form.get("require_follow") ? 1 : 0,
    followGateMessage,
    openerMessage,
    openerButton,
    followUpMessage,
    followUpDelay,
    collectEmail,
    emailPrompt,
    emailThanks,
    emailTiming,
    emailDelay,
    isDefault,
    form.get("active") ? 1 : 0,
  ];

  if (ruleId) {
    if (expiresAt !== undefined) {
      await env.DB.prepare("UPDATE rules SET expires_at = ? WHERE id = ?")
        .bind(expiresAt, ruleId)
        .run();
    }
    await env.DB.prepare(
      `UPDATE rules SET name = ?, media_id = ?, keywords = ?, match_mode = ?, match_any = ?,
              trigger_type = ?, message = ?,
              public_reply_enabled = ?, public_reply_variants = ?, require_follow = ?,
              follow_gate_message = ?, opener_message = ?, opener_button = ?,
              follow_up_message = ?, follow_up_delay_mins = ?,
              collect_email = ?, email_prompt = ?, email_thanks = ?,
              email_timing = ?, email_delay_mins = ?, is_default = ?,
              active = ?
        WHERE id = ?`,
    )
      .bind(...values, ruleId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO rules (id, account_id, name, media_id, keywords, match_mode, match_any, trigger_type, message,
                          public_reply_enabled, public_reply_variants, require_follow,
                          follow_gate_message, opener_message, opener_button,
                          follow_up_message, follow_up_delay_mins,
                          collect_email, email_prompt, email_thanks,
                          email_timing, email_delay_mins, is_default, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, accountId, ...values)
      .run();

    if (expiresAt !== undefined && expiresAt !== null) {
      await env.DB.prepare("UPDATE rules SET expires_at = ? WHERE id = ?")
        .bind(expiresAt, id)
        .run();
    }
  }

  // Demote any previous default. The partial unique index would otherwise
  // reject this write outright, turning a reasonable action into an error.
  if (isDefault) await clearOtherDefaults(env, accountId, id);

  const linkError = await saveLinks(env, id, form);
  if (linkError) return { ok: false, error: linkError };

  return { ok: true, ruleId: id };
}

/**
 * Replace the rule's tracked links.
 *
 * Slugs are preserved across edits where the destination is unchanged, so a
 * link already sitting in someone's DMs keeps working after the operator edits
 * the wording of a message.
 */
async function saveLinks(env: Env, ruleId: string, form: FormData): Promise<string | null> {
  const existing = await linksForRule(env, ruleId);

  for (const position of [0, 1]) {
    const rawUrl = String(form.get(`link_url_${position + 1}`) ?? "").trim();
    const label = String(form.get(`link_label_${position + 1}`) ?? "").trim().slice(0, 20);
    const current = existing[position];

    if (!rawUrl) {
      // Deliberately do NOT delete an existing link just because the field came
      // back empty. Losing it silently destroys the click history and the CTR
      // that history feeds — the operator's only measure of whether any of this
      // worked. Removing a link is an explicit action.
      if (current && form.get(`link_remove_${position + 1}`)) {
        await env.DB.prepare("DELETE FROM tracked_links WHERE id = ?").bind(current.id).run();
      }
      continue;
    }

    const url = safeExternalUrl(rawUrl);
    if (!url) return "Links must start with http:// or https://";

    if (current) {
      await env.DB.prepare("UPDATE tracked_links SET target_url = ?, label = ? WHERE id = ?")
        .bind(url, label || null, current.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO tracked_links (id, rule_id, slug, target_url, label, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(randomId(12), ruleId, randomSlug(), url, label || null, position)
        .run();
    }
  }
  return null;
}

export async function deleteRule(env: Env, ruleId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
}
