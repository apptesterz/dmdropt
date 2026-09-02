-- Custom wording for the follow-gate prompt.
-- Creators phrase this in their own voice; a fixed string reads like a bot.
ALTER TABLE rules ADD COLUMN follow_gate_message TEXT;
