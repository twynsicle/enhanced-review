-- Phase 4: real worker plumbing.
--
-- Three concerns added on top of Phase 3's schema:
--
--   1. Per-job encrypted GitHub token. The API route stores the caller's
--      `provider_token` here at job submit time so the worker can clone
--      private repos. The worker NULLs the column immediately after the
--      clone returns; the row is only carrying a token for a few seconds
--      in the happy path.
--
--   2. `diff_truncated` flag on completed reviews so Phase 6's reader UI
--      can surface a banner when the review was produced from a truncated
--      diff (large PR > 80k tokens).
--
--   3. `review_jobs_cancel` NOTIFY channel: an UPDATE trigger fires when a
--      row transitions into 'cancelled', and the worker LISTENs so it can
--      SIGTERM the running opencode child within milliseconds.
--
-- pgsodium notes:
--   The vendored Supabase Postgres image ships pgsodium and persists the
--   server key seed in /etc/postgresql-custom (mounted via a named volume
--   in supabase/docker-compose.yml). The encryption key for tokens is a
--   pgsodium-managed key looked up by name; encrypt/decrypt is exposed
--   as SECURITY DEFINER functions limited to service_role.
--
-- Idempotent: re-running this file is a no-op.

create extension if not exists pgsodium;

-- ---------------------------------------------------------------------------
-- Encrypted token column + helper functions
-- ---------------------------------------------------------------------------

alter table public.review_jobs
  add column if not exists github_token_encrypted bytea;

-- Provision the AEAD-det key once. pgsodium.create_key throws if a key with
-- the same name already exists, hence the existence check.
do $$
declare
  existing uuid;
begin
  select id into existing from pgsodium.valid_key where name = 'review_jobs_github_token';
  if existing is null then
    perform pgsodium.create_key(name => 'review_jobs_github_token');
  end if;
end $$;

-- Encrypt with the named key. Associated-data binds ciphertext to this
-- table so a copied bytea can't be replayed against another column.
create or replace function public.encrypt_github_token(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  key_uuid uuid;
begin
  if plaintext is null then
    return null;
  end if;
  select id into key_uuid from pgsodium.valid_key where name = 'review_jobs_github_token';
  if key_uuid is null then
    raise exception 'review_jobs_github_token key is missing — re-run migration 0003';
  end if;
  return pgsodium.crypto_aead_det_encrypt(
    convert_to(plaintext, 'utf8'),
    convert_to('review_jobs.github_token', 'utf8'),
    key_uuid
  );
end
$$;

create or replace function public.decrypt_github_token(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  key_uuid uuid;
begin
  if ciphertext is null then
    return null;
  end if;
  select id into key_uuid from pgsodium.valid_key where name = 'review_jobs_github_token';
  if key_uuid is null then
    raise exception 'review_jobs_github_token key is missing — re-run migration 0003';
  end if;
  return convert_from(
    pgsodium.crypto_aead_det_decrypt(
      ciphertext,
      convert_to('review_jobs.github_token', 'utf8'),
      key_uuid
    ),
    'utf8'
  );
end
$$;

revoke execute on function public.encrypt_github_token(text) from public;
revoke execute on function public.decrypt_github_token(bytea) from public;
grant execute on function public.encrypt_github_token(text) to service_role;
grant execute on function public.decrypt_github_token(bytea) to service_role;

-- Atomic create-with-token RPC. The web app calls this from POST /api/jobs
-- so the row is born with the encrypted token already attached — the worker
-- never sees a half-populated row. Returns the new job id.
create or replace function public.create_review_job_with_token(
  p_user_id      uuid,
  p_github_login text,
  p_target       jsonb,
  p_head_sha     text,
  p_token        text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.review_jobs (
    user_id, github_login, target, head_sha, github_token_encrypted
  ) values (
    p_user_id, p_github_login, p_target, p_head_sha,
    public.encrypt_github_token(p_token)
  )
  returning id into new_id;
  return new_id;
end
$$;

revoke execute on function public.create_review_job_with_token(uuid, text, jsonb, text, text) from public;
grant  execute on function public.create_review_job_with_token(uuid, text, jsonb, text, text) to service_role;

-- Lookup-and-decrypt RPC. The worker calls this once it has claimed a job,
-- avoiding the awkward bytea-over-PostgREST round-trip that selecting the
-- column directly would require. Returns NULL if the row is gone or the
-- token has already been cleared.
create or replace function public.decrypt_review_job_token(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  enc bytea;
begin
  select github_token_encrypted into enc
    from public.review_jobs
   where id = p_job_id;
  if enc is null then
    return null;
  end if;
  return public.decrypt_github_token(enc);
end
$$;

revoke execute on function public.decrypt_review_job_token(uuid) from public;
grant  execute on function public.decrypt_review_job_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- diff_truncated flag on reviews
-- ---------------------------------------------------------------------------

alter table public.reviews
  add column if not exists diff_truncated boolean not null default false;

-- ---------------------------------------------------------------------------
-- Cancel notification channel
-- ---------------------------------------------------------------------------

create or replace function public.review_jobs_notify_cancel()
returns trigger
language plpgsql
as $$
begin
  -- Fire only on the pending|running → cancelled transition. The owner-
  -- cancel RLS policy already restricts who can flip the row, so any
  -- update we see here is legitimate.
  if new.status = 'cancelled' and (old.status is distinct from 'cancelled') then
    perform pg_notify('review_jobs_cancel', new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists review_jobs_notify_cancel_trg on public.review_jobs;
create trigger review_jobs_notify_cancel_trg
  after update on public.review_jobs
  for each row execute function public.review_jobs_notify_cancel();
