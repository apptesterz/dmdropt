-- dmdrop schema (D1 / SQLite).
--
-- Single-operator instance: one person, their own deployment, their own
-- accounts. No users table, no memberships, no tenancy — deliberately. Every
-- table that does not exist is a class of bug and a support ticket that cannot
-- happen.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Settings: admin password hash, licence key, setup progress, instance id.
-- Key-value because these are singletons and a column-per-setting schema would
-- need a migration every time one is added.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- Connected Instagram professional accounts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  ig_user_id    TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,

  -- AES-256-GCM. Never plaintext, never logged, never sent to the client.
  token_cipher  TEXT NOT NULL,
  token_expires INTEGER,

  -- Set by the failure taxonomy when an error is fatal for the whole account
  -- rather than one comment. Surfaces once in the dashboard instead of
  -- producing a wall of identical failed sends.
  health        TEXT NOT NULL DEFAULT 'OK'
                CHECK (health IN ('OK','TOKEN_EXPIRED','PERMISSION_REVOKED','NOT_PROFESSIONAL')),
  health_note   TEXT,

  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- Rules: one keyword automation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  name        TEXT NOT NULL,
  -- NULL means "any media on this account"; 'NEXT' means "attach to the next
  -- post published", which is what creators actually want when they set a rule
  -- up before posting.
  media_id    TEXT,

  -- JSON array of strings. SQLite has no array type; validated on write.
  keywords    TEXT NOT NULL,
  match_mode  TEXT NOT NULL DEFAULT 'WHOLE_WORD'
              CHECK (match_mode IN ('WHOLE_WORD','SUBSTRING')),

  message     TEXT NOT NULL,

  public_reply_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (public_reply_enabled IN (0,1)),
  -- JSON array. Several variants so every comment under a post does not get an
  -- identical visible reply, which reads as automation.
  public_reply_variants TEXT NOT NULL DEFAULT '[]',

  require_follow        INTEGER NOT NULL DEFAULT 0 CHECK (require_follow IN (0,1)),

  follow_up_message     TEXT,
  follow_up_delay_mins  INTEGER,

  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_rules_account_active ON rules(account_id, active);

-- ---------------------------------------------------------------------------
-- Send log — one row per (rule, comment).
--
-- THE UNIQUE CONSTRAINT BELOW IS THE LOAD-BEARING PIECE OF THIS SYSTEM.
--
-- Webhooks are re-delivered. Workers die between sending and recording.
-- Retries overlap. Rather than defending against each case in application code
-- — where a read-then-write check always leaves a race window — a second send
-- is made structurally impossible: the row is inserted BEFORE the platform is
-- contacted, and a duplicate attempt fails at insert.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_log (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  comment_id      TEXT NOT NULL,
  commenter_id    TEXT NOT NULL,
  commenter_name  TEXT,
  matched_keyword TEXT,

  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','SENT','PARTIAL','FAILED','SKIPPED','AWAITING_FOLLOW')),

  -- The two delivery legs complete independently and are retried
  -- independently. A retry must never resend a leg that already landed.
  dm_sent_at           INTEGER,
  public_reply_sent_at INTEGER,

  failure_class   TEXT NOT NULL DEFAULT 'NONE'
                  CHECK (failure_class IN ('NONE','TRANSIENT','PERMANENT_COMMENT','PERMANENT_ACCOUNT')),
  error_code      TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,

  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE (rule_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_send_log_created ON send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_rule ON send_log(rule_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tracked links. Messages carry a short slug so the operator sees click-through
-- rate — the only outcome metric that tells them whether the offer worked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracked_links (
  id         TEXT PRIMARY KEY,
  rule_id    TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  label      TEXT,
  clicks     INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_links_rule ON tracked_links(rule_id, position);

-- ---------------------------------------------------------------------------
-- Follower snapshots, for the growth chart.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follower_snapshots (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,          -- YYYY-MM-DD
  followers  INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
);

-- ---------------------------------------------------------------------------
-- Monthly meter.
--
-- The METER is permanent infrastructure; the LIMIT is one config value, set
-- beyond any real usage. Retrofitting usage accounting into a working system is
-- a real refactor touching every send path. Changing a constant is not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_periods (
  period      TEXT PRIMARY KEY,      -- YYYY-MM
  sends       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
