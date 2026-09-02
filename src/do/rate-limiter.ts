/**
 * Rate limiting and reservation counters.
 *
 * A Durable Object rather than a database row because a DO processes one
 * request at a time for a given id. That single-threading is the whole point:
 * "read the counter, decide, then increment" is safe here, and is not safe
 * anywhere else. Without it two workers both read 749, both conclude they are
 * under the 750 ceiling, and both send.
 *
 * Two distinct uses, deliberately sharing one implementation:
 *   - per-account hourly send ceiling (the platform's limit)
 *   - login attempt throttling (brute-force defence)
 */

import { DurableObject } from "cloudflare:workers";

interface Window {
  count: number;
  resetAt: number;
}

export interface ReserveResult {
  allowed: boolean;
  used: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export class RateLimiter extends DurableObject {
  /**
   * Claim one unit against `key`. Returns allowed=false when the window is full.
   *
   * The window is fixed from first use, not sliding: the TTL is set when the
   * counter is created and not extended on later calls. A sliding window would
   * let steady traffic hold the counter alive indefinitely so it never resets.
   */
  async reserve(
    key: string,
    max: number,
    windowSeconds: number,
  ): Promise<ReserveResult> {
    const now = Date.now();
    const existing = await this.ctx.storage.get<Window>(key);

    let window: Window;
    if (!existing || existing.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
    } else {
      window = existing;
    }

    if (window.count >= max) {
      await this.ctx.storage.put(key, window);
      return {
        allowed: false,
        used: window.count,
        remaining: 0,
        resetAt: window.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
      };
    }

    window.count += 1;
    await this.ctx.storage.put(key, window);

    return {
      allowed: true,
      used: window.count,
      remaining: max - window.count,
      resetAt: window.resetAt,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Hand a unit back when the attempt did not consume platform quota — a
   * network failure before the request landed, a token rejected up front.
   *
   * Never call this for a failure that may actually have delivered. A released
   * slot that was in fact spent is how an account drifts over the real ceiling
   * and starts collecting 429s.
   */
  async release(key: string): Promise<void> {
    const window = await this.ctx.storage.get<Window>(key);
    if (!window || window.resetAt <= Date.now() || window.count <= 0) return;
    window.count -= 1;
    await this.ctx.storage.put(key, window);
  }

  async current(key: string): Promise<{ used: number; resetAt: number }> {
    const window = await this.ctx.storage.get<Window>(key);
    if (!window || window.resetAt <= Date.now()) return { used: 0, resetAt: 0 };
    return { used: window.count, resetAt: window.resetAt };
  }

  /** Clear a throttle after a successful login, so one bad day is not punished. */
  async reset(key: string): Promise<void> {
    await this.ctx.storage.delete(key);
  }
}
