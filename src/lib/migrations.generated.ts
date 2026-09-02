/**
 * GENERATED FILE — do not edit.
 *
 * Produced by tools/build-migrations.mjs from migrations/*.sql.
 * Edit the .sql files and re-run that script.
 */

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    "version": 1,
    "name": "0001_init.sql",
    "statements": [
      "PRAGMA foreign_keys = ON",
      "CREATE TABLE IF NOT EXISTS settings (\n  key        TEXT PRIMARY KEY,\n  value      TEXT NOT NULL,\n  updated_at INTEGER NOT NULL DEFAULT (unixepoch())\n)",
      "CREATE TABLE IF NOT EXISTS accounts (\n  id            TEXT PRIMARY KEY,\n  ig_user_id    TEXT NOT NULL UNIQUE,\n  username      TEXT NOT NULL,\n\n  token_cipher  TEXT NOT NULL,\n  token_expires INTEGER,\n\n  health        TEXT NOT NULL DEFAULT 'OK'\n                CHECK (health IN ('OK','TOKEN_EXPIRED','PERMISSION_REVOKED','NOT_PROFESSIONAL')),\n  health_note   TEXT,\n\n  created_at    INTEGER NOT NULL DEFAULT (unixepoch())\n)",
      "CREATE TABLE IF NOT EXISTS rules (\n  id          TEXT PRIMARY KEY,\n  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,\n\n  name        TEXT NOT NULL,\n  media_id    TEXT,\n\n  keywords    TEXT NOT NULL,\n  match_mode  TEXT NOT NULL DEFAULT 'WHOLE_WORD'\n              CHECK (match_mode IN ('WHOLE_WORD','SUBSTRING')),\n\n  message     TEXT NOT NULL,\n\n  public_reply_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (public_reply_enabled IN (0,1)),\n  public_reply_variants TEXT NOT NULL DEFAULT '[]',\n\n  require_follow        INTEGER NOT NULL DEFAULT 0 CHECK (require_follow IN (0,1)),\n\n  follow_up_message     TEXT,\n  follow_up_delay_mins  INTEGER,\n\n  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),\n  created_at  INTEGER NOT NULL DEFAULT (unixepoch())\n)",
      "CREATE INDEX IF NOT EXISTS idx_rules_account_active ON rules(account_id, active)",
      "CREATE TABLE IF NOT EXISTS send_log (\n  id              TEXT PRIMARY KEY,\n  rule_id         TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,\n  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,\n\n  comment_id      TEXT NOT NULL,\n  commenter_id    TEXT NOT NULL,\n  commenter_name  TEXT,\n  matched_keyword TEXT,\n\n  status          TEXT NOT NULL DEFAULT 'PENDING'\n                  CHECK (status IN ('PENDING','SENT','PARTIAL','FAILED','SKIPPED','AWAITING_FOLLOW')),\n\n  dm_sent_at           INTEGER,\n  public_reply_sent_at INTEGER,\n\n  failure_class   TEXT NOT NULL DEFAULT 'NONE'\n                  CHECK (failure_class IN ('NONE','TRANSIENT','PERMANENT_COMMENT','PERMANENT_ACCOUNT')),\n  error_code      TEXT,\n  error_message   TEXT,\n  attempts        INTEGER NOT NULL DEFAULT 0,\n\n  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),\n  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),\n\n  UNIQUE (rule_id, comment_id)\n)",
      "CREATE INDEX IF NOT EXISTS idx_send_log_created ON send_log(created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_send_log_rule ON send_log(rule_id, created_at DESC)",
      "CREATE TABLE IF NOT EXISTS tracked_links (\n  id         TEXT PRIMARY KEY,\n  rule_id    TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,\n  slug       TEXT NOT NULL UNIQUE,\n  target_url TEXT NOT NULL,\n  label      TEXT,\n  clicks     INTEGER NOT NULL DEFAULT 0,\n  position   INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL DEFAULT (unixepoch())\n)",
      "CREATE INDEX IF NOT EXISTS idx_links_rule ON tracked_links(rule_id, position)",
      "CREATE TABLE IF NOT EXISTS follower_snapshots (\n  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,\n  day        TEXT NOT NULL,          -- YYYY-MM-DD\n  followers  INTEGER NOT NULL,\n  PRIMARY KEY (account_id, day)\n)",
      "CREATE TABLE IF NOT EXISTS usage_periods (\n  period      TEXT PRIMARY KEY,      -- YYYY-MM\n  sends       INTEGER NOT NULL DEFAULT 0,\n  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())\n)"
    ]
  },
  {
    "version": 2,
    "name": "0002_match_any.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN match_any INTEGER NOT NULL DEFAULT 0"
    ]
  },
  {
    "version": 3,
    "name": "0003_follow_gate_message.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN follow_gate_message TEXT"
    ]
  },
  {
    "version": 4,
    "name": "0004_opener.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN opener_message TEXT",
      "ALTER TABLE rules ADD COLUMN opener_button TEXT"
    ]
  },
  {
    "version": 5,
    "name": "0005_triggers.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'COMMENT'"
    ]
  },
  {
    "version": 6,
    "name": "0006_capture_and_default.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN collect_email INTEGER NOT NULL DEFAULT 0\n  CHECK (collect_email IN (0, 1))",
      "ALTER TABLE rules ADD COLUMN email_prompt TEXT",
      "ALTER TABLE rules ADD COLUMN email_thanks TEXT",
      "ALTER TABLE rules ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0\n  CHECK (is_default IN (0, 1))",
      "CREATE TABLE IF NOT EXISTS contacts (\n  id           TEXT PRIMARY KEY,\n  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,\n  ig_user_id   TEXT NOT NULL,\n  username     TEXT,\n  email        TEXT,\n  rule_id      TEXT REFERENCES rules(id) ON DELETE SET NULL,\n  send_log_id  TEXT REFERENCES send_log(id) ON DELETE SET NULL,\n  asked_at     INTEGER NOT NULL DEFAULT (unixepoch()),\n  captured_at  INTEGER,\n  UNIQUE (account_id, ig_user_id)\n)",
      "CREATE INDEX IF NOT EXISTS idx_contacts_captured\n  ON contacts (account_id, captured_at DESC)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_one_default\n  ON rules (account_id) WHERE is_default = 1"
    ]
  },
  {
    "version": 7,
    "name": "0007_email_timing.sql",
    "statements": [
      "ALTER TABLE rules ADD COLUMN email_timing TEXT NOT NULL DEFAULT 'BEFORE'\n  CHECK (email_timing IN ('BEFORE', 'AFTER'))",
      "ALTER TABLE rules ADD COLUMN email_delay_mins INTEGER"
    ]
  }
];
