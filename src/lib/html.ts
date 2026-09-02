/**
 * HTML rendering with escaping on by default.
 *
 * The `html` tagged template escapes every interpolated value unless it is
 * explicitly wrapped in `raw()`. That inversion is the point: forgetting to
 * escape is the default failure mode of string-built HTML, so here forgetting
 * produces escaped output, and unsafe output requires typing the word `raw`.
 *
 * Campaign messages, Instagram usernames, and comment text all reach these
 * templates and all originate outside our control.
 */

export class RawHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value instanceof RawHtml) out += value.value;
    else if (Array.isArray(value)) {
      out += value.map((item) => (item instanceof RawHtml ? item.value : escapeHtml(item))).join("");
    } else if (value === null || value === undefined || value === false) {
      out += "";
    } else {
      out += escapeHtml(value);
    }
    out += strings[i + 1] ?? "";
  }
  return new RawHtml(out);
}

// U+2028 and U+2029 are legal inside a JSON string but are literal line
// terminators in JavaScript, so leaving one unescaped breaks a <script> block.
//
// Built via String.fromCharCode rather than written as literal characters: an
// invisible character in source is a maintenance trap, and a previous revision
// of this file was silently broken by exactly that.
const U2028 = String.fromCharCode(0x2028);
const U2029 = String.fromCharCode(0x2029);
const JS_LINE_SEPARATORS = new RegExp(`[${U2028}${U2029}]`, "g");

/**
 * Safe JSON for embedding in a <script> block.
 *
 * Escaping `<` prevents a value containing "</script>" from closing the block
 * early — the classic route from a JSON blob to script injection.
 */
export function jsonForScript(value: unknown): RawHtml {
  return raw(
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(JS_LINE_SEPARATORS, (char) => (char === U2028 ? "\\u2028" : "\\u2029")),
  );
}

/**
 * Validate a user-supplied destination URL.
 *
 * Tracked links redirect to whatever the operator typed. Without this check a
 * `javascript:` or `data:` URL becomes stored XSS for anyone who clicks through
 * from a DM. Only http and https are ever acceptable.
 */
export function safeExternalUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
