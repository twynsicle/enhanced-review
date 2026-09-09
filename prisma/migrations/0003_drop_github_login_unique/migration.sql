-- Drop the UNIQUE constraint on users.github_login.
--
-- Identity is `github_id`; `github_login` is a denormalised cache refreshed on
-- every sign-in. GitHub logins are reusable after a rename or an account
-- deletion, so a login moving between accounts made `upsertUserFromGithub`
-- (which matches on `github_id`) collide with the stale row's login: P2002,
-- the verify callback threw, and that user could never sign in again until the
-- old row was deleted by hand. Nothing queries users by login, so the index
-- is dropped outright rather than downgraded to a plain one.
DROP INDEX "users_github_login_key";
