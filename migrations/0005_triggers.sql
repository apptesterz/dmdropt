-- What starts an automation.
--
--   COMMENT       someone comments on a post          (the original)
--   DM            someone sends a direct message
--   STORY_REPLY   someone replies to a story
--   STORY_MENTION someone mentions the account in their story
--
-- All four are the same job — a person asking for the lead magnet — arriving
-- through different doors, so they share one rule shape and one delivery path.
ALTER TABLE rules ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'COMMENT';
