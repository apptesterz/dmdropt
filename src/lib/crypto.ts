/**
 * Cryptographic primitives. Web Crypto only — this runs on Workers, so there is
 * no node:crypto and no bcrypt.
 *
 * Rules held throughout:
 *   - Every comparison of a secret is constant-time. A fast-failing compare
 *     leaks the expected value one byte at a time.
 *   - Access tokens are encrypted with an authenticated cipher (AES-GCM), so a
 *     tampered ciphertext fails loudly instead of decrypting to plausible junk.
 *   - Randomness is always crypto.getRandomValues, never Math.random.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function toB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex string has an odd length.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("Hex string contains a non-hex character.");
    bytes[i] = byte;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Length is compared first and separately: it leaks only the length, which for
 * tokens of fixed size reveals nothing. The loop itself always runs to
 * completion over the full array.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Random identifiers
// ---------------------------------------------------------------------------

export function randomId(bytes = 16): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * Short slug for tracked links.
 *
 * Alphabet excludes vowels and lookalike characters (0/O, 1/l/I) so a slug
 * cannot spell something unfortunate and is unambiguous if read aloud.
 */
const SLUG_ALPHABET = "bcdfghjkmnpqrstvwxyz23456789";
export function randomSlug(length = 7): string {
  const random = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of random) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  return out;
}

// ---------------------------------------------------------------------------
// Token encryption at rest (AES-256-GCM)
// ---------------------------------------------------------------------------

const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for

async function tokenKey(hexKey: string): Promise<CryptoKey> {
  const raw = fromHex(hexKey);
  if (raw.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars); got ${raw.length} bytes.`,
    );
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Returns "iv.ciphertext", both base64url. The GCM tag is appended by WebCrypto. */
export async function encryptToken(plaintext: string, hexKey: string): Promise<string> {
  const key = await tokenKey(hexKey);
  // A fresh IV per encryption. Reusing one under the same key destroys GCM's
  // security guarantees entirely.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext) as BufferSource,
  );
  return `${toB64url(iv)}.${toB64url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(stored: string, hexKey: string): Promise<string> {
  const [ivPart, dataPart] = stored.split(".");
  if (!ivPart || !dataPart) throw new Error("Stored token is malformed.");
  const key = await tokenKey(hexKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(ivPart) as BufferSource },
    key,
    fromB64url(dataPart) as BufferSource,
  );
  return decoder.decode(plaintext);
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256)
// ---------------------------------------------------------------------------

/**
 * The Workers runtime REFUSES any PBKDF2 call above 100,000 iterations:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 210000).
 *
 * OWASP's guidance for PBKDF2-HMAC-SHA256 is far higher than that ceiling, so
 * a single call cannot reach a defensible cost. Instead the derivation is
 * CHAINED: each round runs at the platform maximum and feeds its output in as
 * the key material for the next. Three rounds cost an attacker the same work as
 * 300,000 iterations, while every individual call stays legal.
 *
 * Note this is not the same as simply raising a number — the rounds are
 * sequential and each depends on the previous, so they cannot be parallelised
 * by an attacker any more than a single long derivation could be.
 */
const PBKDF2_ITERATIONS = 100_000; // platform maximum, not a preference
const PBKDF2_ROUNDS = 3; // 300,000 effective
const SALT_BYTES = 16;
const HASH_BITS = 256;

async function pbkdf2Chain(
  password: string,
  salt: Uint8Array,
  iterations: number,
  rounds: number,
): Promise<Uint8Array> {
  let material: Uint8Array = encoder.encode(password);

  for (let round = 0; round < rounds; round++) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      material as BufferSource,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
      keyMaterial,
      HASH_BITS,
    );
    material = new Uint8Array(bits);
  }

  return material;
}

/** Returns "pbkdf2$<iterations>x<rounds>$<salt>$<hash>", salt and hash base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2Chain(password, salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
  return `pbkdf2$${PBKDF2_ITERATIONS}x${PBKDF2_ROUNDS}$${toB64url(salt)}$${toB64url(hash)}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Cost parameters are read back FROM THE STORED VALUE, never from the constants
 * above, so raising either later re-hashes nobody and locks out nobody.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, cost, saltPart, hashPart] = stored.split("$");
    if (scheme !== "pbkdf2" || !cost || !saltPart || !hashPart) return false;

    const [iterationsPart, roundsPart] = cost.split("x");
    const iterations = Number.parseInt(iterationsPart ?? "", 10);
    const rounds = roundsPart === undefined ? 1 : Number.parseInt(roundsPart, 10);

    // Bounds guard both ways: too low is a weak hash smuggled in, too high is a
    // denial-of-service against our own login path.
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 100_000) return false;
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 10) return false;

    const computed = await pbkdf2Chain(password, fromB64url(saltPart), iterations, rounds);
    return timingSafeEqual(toB64url(computed), hashPart);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HMAC signing (sessions, CSRF tokens)
// ---------------------------------------------------------------------------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload) as BufferSource,
  );
  return toB64url(new Uint8Array(signature));
}

export async function verifySigned(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(signature) as BufferSource,
      encoder.encode(payload) as BufferSource,
    );
  } catch {
    return false;
  }
}

/**
 * Verify a platform webhook signature over the RAW body.
 *
 * The body must be the exact bytes received — re-serialising parsed JSON
 * reorders keys and changes whitespace, so the digest will not match. Meta
 * sends this as "sha256=<hex>".
 */
/**
 * Lowercase hex HMAC-SHA256.
 *
 * The shape Meta signs webhooks with, and the shape the broker signs its
 * forwards with. Extracted so both verifiers compare against one implementation
 * rather than two that could drift apart.
 */
export async function hmacHex(body: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(body) as BufferSource,
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  return timingSafeEqual(header.slice(7).toLowerCase(), await hmacHex(rawBody, appSecret));
}
