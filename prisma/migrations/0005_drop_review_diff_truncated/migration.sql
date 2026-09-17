-- Truncation is a finding, so the column that also said so has no reader left.
--
-- A diff too large for the prompt means part of the change was never shown to
-- the reviewer, which is what the `diff-truncated` warning in `findings`
-- records, in a sentence that says why it matters. The reader drew both, so
-- the page reported the same fact twice in two different voices.
ALTER TABLE "reviews" DROP COLUMN "diff_truncated";
