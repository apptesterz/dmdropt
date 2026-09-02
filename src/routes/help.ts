/**
 * In-app help.
 *
 * This page is a cost-control mechanism, not documentation. At this price point
 * support is the only expense that scales with sales, so every question
 * answered here is a message that never arrives.
 *
 * Written for someone who has never heard the words "webhook" or "API". Short
 * sentences, no jargon, and honest about what the tool cannot do — an
 * expectation corrected here is a refund that does not happen.
 */

import { html } from "../lib/html";
import { layout, icon } from "../lib/ui";

export function renderHelp(nonce: string): Response {
  const body = html`
    <details class="faq" id="how-it-works" open>
      <summary><span class="grow">How it works</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0">
          Someone comments on your post, replies to your story, or sends you a DM.
          If what they wrote matches an automation you set up, they get a message
          back within a few seconds — with your link in it.
        </p>
        <p class="small muted">
          Everything runs on your own account. Nobody else can see your messages,
          your followers, or your links.
        </p>
      </div>
    </details>

    <details class="faq" id="set-one-up-step-by-step">
      <summary><span class="grow">Set one up, step by step</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0"><strong>A reel or a post</strong></p>
        <ol class="small steps-list">
          <li>New automation. Trigger: <em>Someone comments on a post</em>.</li>
          <li>Keyword: one word, e.g. <span class="mono">GUIDE</span>.</li>
          <li>Pick the reel from the pictures, or leave it on "Any post".</li>
          <li>Write the DM and paste your link.</li>
          <li>Save. Then write "comment GUIDE" in your caption.</li>
        </ol>

        <p><strong>A story</strong></p>
        <ol class="small steps-list">
          <li>New automation. Trigger: <em>Someone replies to a story</em>.</li>
          <li>Keyword: one word, e.g. <span class="mono">GUIDE</span>.</li>
          <li>There is no story to pick, and that is on purpose — it works on every
              story you post.</li>
          <li>Write the DM and paste your link.</li>
          <li>Set <em>Stop automatically</em> to <strong>1 day</strong>, so it ends
              when the story does.</li>
          <li>Save. Then put "reply GUIDE" on the story itself.</li>
        </ol>

        <p><strong>Two stories at the same time</strong></p>
        <p class="small muted">
          This is the part people find confusing. You do not choose which story —
          <strong>the keyword does that for you</strong>.
        </p>
        <ol class="small steps-list">
          <li>Story one says "reply <span class="mono">GUIDE</span>". Make an
              automation with keyword GUIDE and your guide link.</li>
          <li>Story two says "reply <span class="mono">PRICE</span>". Make a second
              automation with keyword PRICE and your price link.</li>
          <li>Both run at once. Whoever writes GUIDE gets the guide, whoever writes
              PRICE gets the prices.</li>
        </ol>
        <p class="small muted">
          Do not tick "reply to everyone" on either — both would fire and people
          would get two messages.
        </p>

        <p><strong>A DM</strong></p>
        <ol class="small steps-list">
          <li>New automation. Trigger: <em>Someone sends a DM</em>.</li>
          <li>Keyword, message, link. Save.</li>
          <li>Then say "DM me GUIDE" anywhere — caption, story, bio.</li>
        </ol>
      </div>
    </details>

    <details class="faq" id="old-automations">
      <summary><span class="grow">Old automations</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          A story disappears after a day. An automation does not — it keeps running
          until you stop it. Weeks later somebody could reply to an old story and
          still get that message, pointing at a link you have forgotten about.
        </p>
        <p class="small muted">
          Use <strong>Stop automatically</strong> when you make it. Pick 1 day for
          a story. The automation ends by itself and you never have to remember.
        </p>
        <p class="small muted">
          On the dashboard you will see <span class="chip warn">Stops in 1d</span>
          while it is counting down, then <span class="chip bad">Expired</span>
          once it has finished. Anything still running but untouched for a month
          shows <span class="chip warn">Idle 30+ days</span> — worth a look.
        </p>
        <p class="small muted">
          Nothing is deleted. You can turn an expired automation back on, or give
          it a new stop date, any time.
        </p>
      </div>
    </details>

    <details class="faq" id="the-four-triggers">
      <summary><span class="grow">The four triggers</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0"><strong>Someone comments on a post</strong></p>
        <p class="small muted">
          The usual one. They comment your keyword under a reel or photo, and get a
          DM. You can point it at one specific post, or leave it on "Any post" so
          it works on everything you publish from now on.
        </p>

        <p><strong>Someone sends a DM</strong></p>
        <p class="small muted">
          They message you the keyword directly, without commenting anywhere.
          Useful when you say "DM me PRICE" in a caption or on a story.
        </p>

        <p><strong>Someone replies to a story</strong></p>
        <p class="small muted">
          They reply to your story with the keyword. This works on every story you
          post — you never have to pick one, and you never have to set it up again
          tomorrow.
        </p>

        <p><strong>Someone mentions you in their story</strong></p>
        <p class="small muted">
          Somebody tags you in their own story and you thank them automatically.
          There are no words to match here, so this one fires every time.
        </p>
      </div>
    </details>

    <details class="faq" id="keywords">
      <summary><span class="grow">Keywords</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          A keyword is the word people have to write to get your message. Put a few
          in, separated by commas. Any one of them works.
        </p>
        <p class="small muted">
          Capital letters do not matter. <span class="mono">LINK</span>,
          <span class="mono">link</span> and <span class="mono">Link</span> are all
          the same. Emojis and full stops are ignored, so "link!! 🔥" still works.
        </p>
        <p><strong>Match inside longer words</strong></p>
        <p class="small muted">
          Leave this off most of the time. Off means "linking" will not set off the
          keyword "link". Turn it on only if you want part-words to count.
        </p>
        <p><strong>Running two stories at once</strong></p>
        <p class="small muted">
          Use different keywords. Say "reply GUIDE" on one story and "reply PRICE"
          on the other, then make two automations. Whichever word they write
          decides which message they get.
        </p>
      </div>
    </details>

    <details class="faq" id="reply-to-everyone">
      <summary><span class="grow">Reply to everyone</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          Tick this and <strong>everybody</strong> who comments gets the message,
          whatever they wrote. No keyword needed.
        </p>
        <p class="small muted">
          Good for a giveaway, or a post where you want to reply to everyone.
        </p>
        <p class="small muted">
          Do not tick it if you have two automations running on the same thing —
          both would fire, and people would get two messages.
        </p>
      </div>
    </details>

    <details class="faq" id="asking-people-to-follow-first">
      <summary><span class="grow">Asking people to follow first</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">This happens in three steps. Here is what they see:</p>
        <ol class="small steps-list">
          <li>
            <strong>Your first message</strong>, with a button. Something like
            "Thanks for commenting! Tap below and I'll send it over."
          </li>
          <li>
            They tap. If they already follow you, they get your link straight away
            and never see step 3.
          </li>
          <li>
            If they do not follow you yet, they get a message with a
            <strong>Follow</strong> button and an <strong>I'm following</strong>
            button. Once they tap that, they get your link.
          </li>
        </ol>
        <p class="small muted">
          <strong>Why the first message exists.</strong> Instagram will not tell us
          whether somebody follows you until they have tapped something first. So
          the first message has to go out before we can check. This is an Instagram
          rule, not a choice — every tool that does this works the same way.
        </p>
        <p class="small muted">
          <strong>Worth knowing:</strong> asking people to follow gets you
          followers, but fewer people reach your link. Watch your click rate before
          and after and decide if it is worth it for you.
        </p>
      </div>
    </details>

    <details class="faq" id="links-and-your-click-rate">
      <summary><span class="grow">Links and your click rate</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          Put your link in and it becomes a button in the message. Every tap is
          counted.
        </p>
        <p class="small muted">
          <strong>Click rate</strong> is the number that matters. It means: out of
          everyone who got your message, how many actually tapped the link. Fifty
          messages and ten taps is a 20% click rate.
        </p>
        <p class="small muted">
          "Message sent" tells you nothing on its own. The click rate tells you
          whether people actually wanted what you offered.
        </p>
        <p class="small muted">
          You can add two buttons. Give them different wording and see which one
          gets tapped more — that is a free experiment.
        </p>
      </div>
    </details>

    <details class="faq" id="public-replies">
      <summary><span class="grow">Public replies</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          As well as the DM, you can reply underneath their comment where everyone
          can see it. This shows other people that commenting works.
        </p>
        <p class="small muted">
          Write three or four different replies, one per line. We rotate them.
          The same reply under every single comment looks like a robot, and
          Instagram notices that kind of thing.
        </p>
      </div>
    </details>

    <details class="faq" id="what-the-results-mean">
      <summary><span class="grow">What the results mean</span>${icon("down", 20)}</summary>
      <div class="body">
        <div class="list-item"><span><strong>Delivered</strong></span>
          <span class="small muted">They got it.</span></div>
        <div class="list-item"><span><strong>Queued</strong></span>
          <span class="small muted">On its way, a moment behind.</span></div>
        <div class="list-item"><span><strong>Waiting for them to follow</strong></span>
          <span class="small muted">They have not tapped yet.</span></div>
        <div class="list-item"><span><strong>Already replied</strong></span>
          <span class="small muted">Instagram allows one reply per comment, ever.</span></div>
        <div class="list-item"><span><strong>Comment too old</strong></span>
          <span class="small muted">Instagram will not let us reply to old comments.</span></div>
        <div class="list-item"><span><strong>Hourly limit reached</strong></span>
          <span class="small muted">Nothing is lost. It sends itself later.</span></div>
        <div class="list-item"><span><strong>Reconnect Instagram</strong></span>
          <span class="small muted">Go to Settings and connect again.</span></div>
      </div>
    </details>

    <details class="faq" id="instagram-s-rules">
      <summary><span class="grow">Instagram's rules</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          These are limits Instagram sets. No tool can get around them, and any
          tool claiming otherwise will get your account restricted.
        </p>
        <ul class="small steps-list">
          <li>750 replies per hour. Above that we wait and send the rest later.</li>
          <li>One private reply per comment. If somebody comments twice, that is
              two comments and they get two replies.</li>
          <li>After someone messages you, you have 24 hours to reply. If they go
              quiet for longer, that conversation closes.</li>
          <li>You cannot message your whole follower list. Instagram does not
              allow it — for anyone.</li>
        </ul>
      </div>
    </details>

    <details class="faq" id="nothing-is-sending">
      <summary><span class="grow">Nothing is sending</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">Check these in order. It is almost always the first one.</p>
        <ol class="small steps-list">
          <li>Is the automation switched <strong>on</strong>? Look for "Paused".</li>
          <li>Did you comment from a <strong>different account</strong>? Your own
              comments are ignored on purpose.</li>
          <li>Does the word match? "linking" does not set off "link" unless you
              turned on match-inside-words.</li>
          <li>Is the <strong>Delivery log</strong> completely empty? That means
              Instagram never told us anything happened — a setup problem. Empty is
              different from a row with an error.</li>
          <li>Is your account showing a red warning on the dashboard? Reconnect
              from Settings.</li>
          <li><strong>Did the comment stay up?</strong> Refresh the post and
              check it is still there. Instagram sometimes removes a comment
              quietly — most often on a new account, or one posting the same
              words over and over, which its spam systems read as a robot. A
              removed comment never reaches us at all, so nothing can reply
              to it.</li>
        </ol>
        <p class="small muted">
          That last one catches people out while testing, because commenting the
          same keyword ten times from one account is exactly what Instagram
          treats as spam. Test from a normal account you actually use, and vary
          the wording.
        </p>
      </div>
    </details>

    <details class="faq" id="what-this-cannot-do">
      <summary><span class="grow">What this cannot do</span>${icon("down", 20)}</summary>
      <div class="body">
        <p class="mt-0 small muted">
          Being straight with you, so you are not waiting for something that is not
          coming:
        </p>
        <ul class="small steps-list">
          <li>WhatsApp messages</li>
          <li>Messaging your whole follower list at once</li>
          <li>Long back-and-forth conversations</li>
          <li>Several people managing the same account</li>
        </ul>
        <p class="small muted">
          This does one job: someone asks for your link, they get your link.
        </p>
      </div>
    </details>

    <div class="card mt-24">
      <span class="overline">Still stuck</span>
      <a class="tile" href="mailto:baviskoo@gmail.com?subject=dmdrop%20help">
        <span class="ic">${icon("mail", 20)}</span>
        <div class="grow">
          <div class="title">Email support</div>
          <div class="sub link">baviskoo@gmail.com</div>
        </div>
        <span class="go">${icon("out", 20)}</span>
      </a>
      <a class="tile" href="/setup">
        <span class="ic">${icon("plug", 20)}</span>
        <div class="grow">
          <div class="title">Re-run the setup checks</div>
          <div class="sub">Shows which of the four steps is incomplete.</div>
        </div>
        <span class="go">${icon("chevron", 20)}</span>
      </a>
    </div>

    <p class="ver">dmdrop · running on your own Cloudflare account</p>
  `;

  return new Response(
    layout(
      { title: "Help", heading: "Help", nonce, session: true, tab: "help" },
      body,
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
