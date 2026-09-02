-- The opener: the first message, sent as the private reply to the comment.
--
-- It exists to earn a tap. A tap starts a real conversation, and only then will
-- the platform answer whether the person follows the account — so the follow
-- gate is impossible until this message has been sent and acted on.
ALTER TABLE rules ADD COLUMN opener_message TEXT;
ALTER TABLE rules ADD COLUMN opener_button TEXT;
