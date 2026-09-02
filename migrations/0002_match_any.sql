-- Reply to EVERY comment, with no keyword.
--
-- A separate explicit column rather than "empty keywords means match all":
-- an empty list arising from a bug would then silently DM every commenter,
-- which is the worst possible failure mode for this product. Opting in has to
-- be deliberate and visible.
ALTER TABLE rules ADD COLUMN match_any INTEGER NOT NULL DEFAULT 0;
