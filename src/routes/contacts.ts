/**
 * Captured email addresses, and the export.
 *
 * The export is the point. An address sitting in this instance is worth
 * nothing until it is in the mailing tool the creator actually sends from, so
 * the download is a first-class action rather than a buried admin feature.
 */

import type { Env } from "../env";
import { html, raw } from "../lib/html";
import { layout, icon, notice } from "../lib/ui";
import { listContacts, countContacts, type ContactRow } from "../lib/db";

function when(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export async function renderContacts(env: Env, nonce: string): Promise<Response> {
  const [contacts, counts] = await Promise.all([listContacts(env), countContacts(env)]);
  const waiting = counts.asked - counts.captured;

  const body = html`
    <div class="stats two">
      <div class="stat">
        <div class="k">Addresses collected</div>
        <div class="n">${counts.captured}</div>
      </div>
      <div class="stat">
        <div class="k">Asked, not yet answered</div>
        <div class="n">${waiting < 0 ? 0 : waiting}</div>
      </div>
    </div>

    ${
      contacts.length === 0
        ? html`<div class="card empty mt-24">
            <div class="icon">${icon("mail", 22)}</div>
            <h3>No addresses yet</h3>
            <p class="small muted">
              Turn on <strong>Email capture</strong> in an automation. The link is
              held back until the person replies with their address, and it shows
              up here.
            </p>
            <p class="mt-14"><a class="btn" href="/campaigns/new">Set one up</a></p>
          </div>`
        : html`<div class="sec-head">
              <h2>Your list</h2>
              <a class="btn sm" href="/contacts.csv" download>Download CSV</a>
            </div>
            ${contacts.map(
              (contact) => html`<div class="ev">
                <div class="grow">
                  <div class="who">${contact.email}</div>
                  <div class="rule">
                    ${contact.username ? `@${contact.username}` : "Instagram user"}
                  </div>
                </div>
                <div class="right">
                  <span class="when">${when(contact.captured_at)}</span>
                </div>
              </div>`,
            )}
            <p class="small muted mt-14">
              Showing the most recent ${contacts.length}. The download contains
              every address.
            </p>`
    }

    ${
      counts.captured > 0
        ? notice(
            "warn",
            "These addresses were given to you directly. Tell people what you will " +
              "send before you send it, and put an unsubscribe link in every email — " +
              "that is the law in most countries, including India.",
          )
        : raw("")
    }
  `;

  return new Response(
    layout({ title: "Contacts", heading: "Contacts", nonce, session: true, tab: "contacts" }, body),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * One CSV field.
 *
 * Quoted and doubled per RFC 4180, and a leading =, +, - or @ is prefixed with
 * a single quote. Those four characters make Excel and Sheets treat the cell as
 * a formula, and the values here come from strangers on the internet — an
 * address like `=cmd|...` is a known way to turn a contact export into code
 * execution on the machine that opens it.
 */
function csvField(value: string | null): string {
  const text = value ?? "";
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function exportContacts(env: Env): Promise<Response> {
  const contacts = await listContacts(env, 50_000);

  const rows = [
    "email,instagram_username,collected_on",
    ...contacts.map((contact: ContactRow) =>
      [
        csvField(contact.email),
        csvField(contact.username),
        csvField(when(contact.captured_at)),
      ].join(","),
    ),
  ];

  return new Response(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dmdrop-contacts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
