/**
 * Applying the schema from inside the Worker.
 *
 * A customer who deploys with one click never runs `wrangler d1 execute`, so
 * nothing else is going to create their tables. The instance brings its own
 * schema and brings itself up to date after an upgrade.
 *
 * Three things make this safe to run on every cold start:
 *
 *   1. A recorded version, so finished migrations are never re-run.
 *   2. Statement-level tolerance of "already exists", because an operator who
 *      applied some migrations by hand — as the first instances did — has a
 *      database that is ahead of its recorded version.
 *   3. It never drops or rewrites anything. Every migration is additive, so a
 *      partial application leaves a working database rather than a broken one.
 */

import type { Env } from "../env";
import { MIGRATIONS } from "./migrations.generated";

/** Cached per isolate: checked once per cold start, not once per request. */
let applied = false;

const VERSION_KEY = "schema_version";

/**
 * Errors that mean "this migration's work is already done".
 *
 * SQLite reports these when a column or table already exists. On a fresh
 * database none of them can occur; on a hand-migrated one they are expected and
 * are the whole reason this is tolerant rather than strict.
 */
function alreadyApplied(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("duplicate column") ||
    text.includes("already exists") ||
    text.includes("duplicate column name")
  );
}

async function currentVersion(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
      .bind(VERSION_KEY)
      .first<{ value: string }>();
    return Number.parseInt(row?.value ?? "0", 10) || 0;
  } catch {
    // No settings table yet, so nothing has ever been applied. This is the
    // normal path on a brand-new deployment.
    return 0;
  }
}

/**
 * Bring the database up to date. Safe to call concurrently and repeatedly.
 *
 * Two requests arriving together on a cold instance may both run this. That is
 * harmless: D1 serialises writes, every statement is additive, and the second
 * run finds its work already done and moves on.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (applied) return;

  const from = await currentVersion(env);
  const pending = MIGRATIONS.filter((migration) => migration.version > from);

  if (pending.length === 0) {
    applied = true;
    return;
  }

  console.log(`[schema] at version ${from}, applying ${pending.length} migration(s)`);

  for (const migration of pending) {
    for (const statement of migration.statements) {
      try {
        await env.DB.prepare(statement).run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (alreadyApplied(message)) continue;

        // A real failure. Left un-recorded so the next cold start tries again,
        // and thrown so it surfaces in the log rather than leaving a half-built
        // database that fails mysteriously later.
        console.error(`[schema] ${migration.name} failed: ${message}`);
        throw error;
      }
    }

    // Recorded per migration, not once at the end, so an interrupted run
    // resumes from where it stopped rather than repeating everything.
    await env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    )
      .bind(VERSION_KEY, String(migration.version))
      .run();
  }

  console.log(`[schema] now at version ${MIGRATIONS[MIGRATIONS.length - 1]?.version ?? from}`);
  applied = true;
}

/** The version this build expects. Used by the health endpoint. */
export function targetVersion(): number {
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}
