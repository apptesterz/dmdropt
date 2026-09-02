-- When to ask for the email address.
--
-- Two honest trade-offs, and which is right depends on the automation rather
-- than on taste, so it is a per-rule choice instead of a product-wide decision:
--
--   BEFORE  The link is withheld until they reply with an address. The address
--           is the price of the thing. Captures far more, and is the whole
--           point of a lead magnet — but it is a wall in front of a stranger
--           who only wanted a link.
--
--   AFTER   The link goes out immediately, and the question follows a few
--           minutes later. Almost nobody is annoyed; far fewer answer, because
--           they already have what they came for.
--
-- AFTER carries a delivery caveat that BEFORE does not. A comment does not open
-- an Instagram messaging window, so the later question can only be delivered if
-- that person has since replied. It is dependable on DM and story-reply
-- triggers, where their message opened the window, and best-effort on comments.

ALTER TABLE rules ADD COLUMN email_timing TEXT NOT NULL DEFAULT 'BEFORE'
  CHECK (email_timing IN ('BEFORE', 'AFTER'));

-- Only meaningful for AFTER. Minutes.
ALTER TABLE rules ADD COLUMN email_delay_mins INTEGER;
