/**
 * Licence key verification.
 *
 * Ed25519 signature, verified **offline** against a public key baked into the
 * build. No licence server, no network call, no dependency on us. A customer
 * who bought a perpetual licence must not be able to lose their product because
 * our endpoint went down or we stopped existing — that promise is a large part
 * of what justifies the price, and a phone-home check would quietly break it.
 *
 * Two rules that must never be violated:
 *
 *   1. An EXPIRED UPDATE PERIOD DOES NOT DISABLE THE PRODUCT. It only stops new
 *      versions being offered. The software they bought keeps running forever.
 *
 *   2. The optional activation ping (see `reportActivation`) FAILS OPEN. It is
 *      telemetry for spotting one key running on forty instances. It is not a
 *      gate, and nothing waits on it.
 *
 * The private key that signs these lives offline on the issuer's machine and
 * must never enter this repository.
 */

export type Edition = "PERSONAL" | "PRO" | "AGENCY";

/** Replaced at release time by the issuing script. Ed25519 public key, base64url. */
export const LICENCE_PUBLIC_KEY = "DVOQ-aL5vAVIRLT-H-7d4lEsmHQxKX_Ovci6uDfcRzw";

/**
 * Per-buyer build identifier.
 *
 * Disclosed to the customer in clause 6 of the licence — this is deliberate and
 * above board, not a hidden tracker. Its purpose is attribution: if a rebranded
 * copy turns up on a marketplace, this says which purchase it came from. That
 * turns "someone is reselling us" into "this buyer is reselling us", which is
 * the difference between a grievance and an actionable claim.
 *
 * Configuration, not a source constant. It used to be a `__BUILD_ID__`
 * placeholder that had to be hand-edited before packaging each buyer's
 * download — a manual step that gets skipped, and skipping it is worse than
 * having no stamp at all: every copy ends up identical while the licence tells
 * the buyer otherwise. As a var it is set the same way as every other
 * per-deployment value, and an unset one reports itself honestly.
 */
export function buildId(env: { BUILD_ID?: string }): string {
  return env.BUILD_ID?.trim() || "unstamped";
}

interface LicencePayload {
  v: number;
  id: string;
  name: string;
  email: string;
  ed: Edition;
  /** Connected-account limit. 0 means unlimited. */
  acc: number;
  /** Issued at, unix seconds. */
  iat: number;
  /** Updates included until, unix seconds. */
  upto: number;
}

export interface Licence {
  valid: boolean;
  reason?: string;
  edition: Edition;
  accountLimit: number;
  buyerName: string;
  buyerEmail: string;
  purchaseId: string;
  issuedAt: Date | null;
  updatesUntil: Date | null;
  /** False once the update period has lapsed. Does NOT affect operation. */
  updatesActive: boolean;
}

const UNLICENSED: Licence = {
  valid: false,
  edition: "PERSONAL",
  accountLimit: 0,
  buyerName: "",
  buyerEmail: "",
  purchaseId: "",
  issuedAt: null,
  updatesUntil: null,
  updatesActive: false,
};

function b64urlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Verify a licence key. Pure, offline, no side effects.
 *
 * Key format: DD1.<base64url payload>.<base64url signature>
 */
export async function verifyLicence(
  key: string,
  publicKeyB64url: string = LICENCE_PUBLIC_KEY,
): Promise<Licence> {
  try {
    const parts = key.trim().split(".");
    if (parts.length !== 3 || parts[0] !== "DD1") {
      return { ...UNLICENSED, reason: "Licence key is malformed." };
    }

    const [, payloadPart, signaturePart] = parts as [string, string, string];
    const signedBytes = new TextEncoder().encode(payloadPart);

    const publicKey = await crypto.subtle.importKey(
      "raw",
      b64urlToBytes(publicKeyB64url) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const signatureValid = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      b64urlToBytes(signaturePart) as BufferSource,
      signedBytes as BufferSource,
    );

    if (!signatureValid) {
      return { ...UNLICENSED, reason: "Licence key signature is not valid." };
    }

    const payload = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payloadPart)),
    ) as LicencePayload;

    const now = Math.floor(Date.now() / 1000);

    return {
      valid: true,
      edition: payload.ed,
      accountLimit: payload.acc,
      buyerName: payload.name,
      buyerEmail: payload.email,
      purchaseId: payload.id,
      issuedAt: new Date(payload.iat * 1000),
      updatesUntil: new Date(payload.upto * 1000),
      // Lapsed updates change what we OFFER, never what we RUN.
      updatesActive: now < payload.upto,
    };
  } catch {
    return { ...UNLICENSED, reason: "Licence key could not be read." };
  }
}

/** Feature gating. Pro features are included in Agency. */
export function hasPro(licence: Licence): boolean {
  return licence.valid && (licence.edition === "PRO" || licence.edition === "AGENCY");
}

/**
 * Enforced when connecting an account, not on every send.
 *
 * The realistic revenue leak is not casual piracy — it is one agency running
 * one Personal licence across forty client accounts. Checking here makes that a
 * clear, provable breach instead of an argument.
 */
export function canConnectAnotherAccount(licence: Licence, connected: number): boolean {
  if (!licence.valid) return false;
  if (licence.accountLimit === 0) return true;
  return connected < licence.accountLimit;
}

/**
 * Optional activation ping. Fire and forget, never awaited on a user path.
 *
 * Sends only the licence key and an instance identifier — never campaign
 * content, tokens, or any Instagram data. Every failure is swallowed on
 * purpose: this must not be able to affect the customer's product.
 */
export async function reportActivation(
  licenceKey: string,
  instanceId: string,
  endpoint: string | undefined,
  build: string,
): Promise<void> {
  if (!endpoint) return;
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey, instanceId, buildId: build }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Intentionally silent. See rule 2 in the header.
  }
}
