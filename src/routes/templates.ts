/**
 * The template gallery.
 *
 * Picking one opens the editor with every field filled in. Nothing is saved
 * until the creator presses the button themselves, so a template can never put
 * a message live that they have not read.
 */

import { html, raw } from "../lib/html";
import { layout, icon } from "../lib/ui";
import { TEMPLATES, CATEGORIES, type Template } from "../lib/templates";

function triggerChip(trigger: Template["trigger"]) {
  const label =
    trigger === "DM"
      ? "DM"
      : trigger === "STORY_REPLY"
        ? "Story reply"
        : trigger === "STORY_MENTION"
          ? "Story mention"
          : "Comment";
  return raw(`<span class="chip accent">${label}</span>`);
}

export function renderTemplates(nonce: string): Response {
  const body = html`
    <p class="small muted mt-0">
      A starting point, not a decision. Pick one and the editor opens with the
      wording filled in — change anything you like before you save it.
    </p>

    ${CATEGORIES.map((category) => {
      const items = TEMPLATES.filter((template) => template.category === category);
      if (items.length === 0) return raw("");
      return html`
        <h2>${category}</h2>
        <div class="rows">
          ${items.map(
            (template) => html`<a class="row-link" href="/campaigns/new?template=${template.id}">
              <span class="grow">
                <span class="title">${template.name}</span>
                <span class="meta">
                  ${triggerChip(template.trigger)}
                  ${
                    template.collectEmail
                      ? raw('<span class="chip ok">Collects email</span>')
                      : raw("")
                  }
                  ${
                    template.requireFollow
                      ? raw('<span class="chip warn">Follow gate</span>')
                      : raw("")
                  }
                  <span>${template.blurb}</span>
                </span>
              </span>
              <span class="chev">${icon("chevron", 20)}</span>
            </a>`,
          )}
        </div>
      `;
    })}

    <p class="ver">${TEMPLATES.length} templates</p>
  `;

  return new Response(
    layout({ title: "Templates", heading: "Templates", nonce, session: true, tab: "home" }, body),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
