-- Record what validating the model's answer found.
--
-- A review used to arrive with no trace of what it cost to obtain: the
-- parsers repaired a dropped anchor, a malformed diagram or a promoted
-- passage in silence, and a review pieced back together was indistinguishable
-- from one that arrived intact. The findings list is that trace. It is never
-- fatal — a disqualifying finding fails the job, so no row is written — which
-- is why an empty array is both the default and the common case.
ALTER TABLE "reviews" ADD COLUMN "findings" JSONB NOT NULL DEFAULT '[]';
