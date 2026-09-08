-- Drop the GitHub allowlist (phase-5-plan P5-D3).
--
-- Signing in with GitHub is now the only condition for access; the table,
-- the `isAllowed` rule, the /denied page and the seed-allowlist job are all
-- removed. Access control is whatever fronts the deployment.
DROP TABLE "allowed_users";
