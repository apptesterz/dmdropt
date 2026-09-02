-- Email capture, and the default reply.
--
-- Email capture is the only feature here that changes what the product is for.
-- A follower is rented from Instagram; an email address is owned, and it
-- survives an algorithm change or a lost account. The exchange is deliberate:
-- when capture is on, the automation asks for the address BEFORE it hands over
-- the link, because a link given away first is a link nobody pays for.
--
-- It is also the only sequence here that is safe under Instagram's messaging
-- window. Their reply is what opens the 24-hour window, so the message that
-- follows — the thanks, carrying the link — is permitted rather than merely
-- attempted.

ALTER TABLE rules ADD COLUMN collect_email INTEGER NOT NULL DEFAULT 0
  CHECK (collect_email IN (0, 1));

-- What we say when asking. Appended to the automation's own message.
ALTER TABLE rules ADD COLUMN email_prompt TEXT;

-- What we say once we have it. This message carries the link buttons.
ALTER TABLE rules ADD COLUMN email_thanks TEXT;

-- The catch-all. Fires only when no other rule matched, so it can never
-- double-send alongside a keyword rule.
ALTER TABLE rules ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK (is_default IN (0, 1));

CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ig_user_id   TEXT NOT NULL,
  username     TEXT,
  -- NULL means asked but not yet answered. That state is what the webhook
  -- looks for when deciding whether an incoming message is an email reply.
  email        TEXT,
  -- Which automation asked, and which send it belongs to. The send log carries
  -- the links to hand over once the address arrives.
  rule_id      TEXT REFERENCES rules(id) ON DELETE SET NULL,
  send_log_id  TEXT REFERENCES send_log(id) ON DELETE SET NULL,
  asked_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  captured_at  INTEGER,
  -- One row per person per account. Asking again updates the existing row
  -- rather than creating a second, so an export never contains duplicates.
  UNIQUE (account_id, ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_captured
  ON contacts (account_id, captured_at DESC);

-- Only one default reply per account may be live at a time. A partial index
-- enforces it in the database rather than trusting the editor to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_one_default
  ON rules (account_id) WHERE is_default = 1;
