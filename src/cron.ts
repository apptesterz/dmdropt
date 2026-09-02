/**
 * Daily maintenance.
 *
 * Two jobs, both about the instance looking after itself so the operator never
 * has to. At this price point, anything that requires manual intervention is a
 * support ticket that costs more than the sale.
 */

import type { Env } from "./env";
import { loadConfig } from "./lib/config";
import { decryptToken, encryptToken } from "./lib/crypto";
import { listAccounts, setAccountHealth } from "./lib/db";
import { refreshLongLived, getProfile } from "./lib/instagram";

export async function runDailyMaintenance(env: Env): Promise<void> {
  const config = await loadConfig(env);
  const accounts = await listAccounts(env);
  const today = new Date().toISOString().slice(0, 10);

  for (const account of accounts) {
    let token: string;
    try {
      token = await decryptToken(account.token_cipher, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      await setAccountHealth(env, account.id, "TOKEN_EXPIRED", "Stored token could not be read.");
      continue;
    }

    // --- Refresh the token ------------------------------------------------
    // Daily, not near expiry. Long-lived tokens last 60 days, so refreshing
    // every day means an instance can be offline for weeks and still recover on
    // its own. Waiting until the last minute means one missed cron costs the
    // operator a manual reconnect.
    try {
      const refreshed = await refreshLongLived(token);
      if (refreshed.access_token) {
        token = refreshed.access_token;
        await env.DB.prepare(
          "UPDATE accounts SET token_cipher = ?, token_expires = ?, health = 'OK', health_note = NULL WHERE id = ?",
        )
          .bind(
            await encryptToken(token, env.TOKEN_ENCRYPTION_KEY),
            Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 5_184_000),
            account.id,
          )
          .run();
      }
    } catch (error) {
      // A refresh failure is an operator problem, not a transient one — mark it
      // so the dashboard shows a single actionable banner instead of letting
      // every future send fail silently.
      await setAccountHealth(
        env,
        account.id,
        "TOKEN_EXPIRED",
        error instanceof Error ? error.message.slice(0, 200) : "Token refresh failed.",
      );
      continue;
    }

    // --- Follower snapshot -------------------------------------------------
    // Best effort. A missing data point is a gap in a chart, never a failure.
    try {
      const profile = await getProfile(config, token);
      if (typeof profile.followers_count === "number") {
        await env.DB.prepare(
          `INSERT INTO follower_snapshots (account_id, day, followers) VALUES (?, ?, ?)
           ON CONFLICT(account_id, day) DO UPDATE SET followers = excluded.followers`,
        )
          .bind(account.id, today, profile.followers_count)
          .run();
      }
      if (profile.username && profile.username !== account.username) {
        await env.DB.prepare("UPDATE accounts SET username = ? WHERE id = ?")
          .bind(profile.username, account.id)
          .run();
      }
    } catch {
      // Ignored on purpose.
    }
  }

  // Pause rules that have reached their stop date. They already stop firing the
  // moment they expire — this only flips the flag so the dashboard shows the
  // real state instead of an "Active" rule that quietly does nothing.
  await env.DB.prepare(
    "UPDATE rules SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= unixepoch()",
  ).run();

  // Keep the log bounded. D1's free tier is generous but not infinite, and a
  // creator has no interest in a delivery record from four months ago.
  await env.DB.prepare("DELETE FROM send_log WHERE created_at < unixepoch() - 7776000").run();
}
