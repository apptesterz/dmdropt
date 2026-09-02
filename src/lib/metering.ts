/**
 * Monthly send meter.
 *
 * The METER is permanent infrastructure. The LIMIT is one configuration value,
 * set beyond any plausible real usage.
 *
 * Keeping them separate is deliberate and is the most transferable lesson from
 * the teardown that produced this project: retrofitting usage accounting into a
 * working system is a real refactor touching every send path, while changing a
 * constant is not. Building the meter now costs almost nothing and leaves every
 * future commercial decision open without committing to any of them.
 */

import type { Env } from "../env";

function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface MeterResult {
  allowed: boolean;
  used: number;
  limit: number;
  period: string;
}

/**
 * Claim one send against this month's counter.
 *
 * The conditional UPDATE does the claim and the bounds check in a single
 * statement, so two concurrent consumers cannot both observe room and both
 * proceed. Rollover is an INSERT that only fires for a period that does not yet
 * exist.
 */
export async function reserveSend(env: Env): Promise<MeterResult> {
  const limit = Number(env.MONTHLY_SEND_CAP ?? 2_000_000_000);
  const period = currentPeriod();

  await env.DB.prepare(
    "INSERT INTO usage_periods (period, sends) VALUES (?, 0) ON CONFLICT(period) DO NOTHING",
  )
    .bind(period)
    .run();

  const claimed = await env.DB.prepare(
    `UPDATE usage_periods
        SET sends = sends + 1, updated_at = unixepoch()
      WHERE period = ? AND sends < ?
      RETURNING sends`,
  )
    .bind(period, limit)
    .first<{ sends: number }>();

  if (claimed) {
    return { allowed: true, used: claimed.sends, limit, period };
  }

  const row = await env.DB.prepare("SELECT sends FROM usage_periods WHERE period = ?")
    .bind(period)
    .first<{ sends: number }>();

  return { allowed: false, used: row?.sends ?? limit, limit, period };
}

/** Give a counted send back when it turned out not to happen. */
export async function releaseSend(env: Env, period: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE usage_periods SET sends = sends - 1, updated_at = unixepoch() WHERE period = ? AND sends > 0",
  )
    .bind(period)
    .run();
}

export async function monthlyUsage(env: Env): Promise<{ used: number; period: string }> {
  const period = currentPeriod();
  const row = await env.DB.prepare("SELECT sends FROM usage_periods WHERE period = ?")
    .bind(period)
    .first<{ sends: number }>();
  return { used: row?.sends ?? 0, period };
}
