-- Phase 3: review job lifecycle.
--
-- Tables:
--   review_jobs    queue + lifecycle for a single review attempt.
--   reviews        the final structured NarrativeReview, one per completed job.
--   review_chunks  streamed partial output, fed to the page via Supabase Realtime.
--
-- Notification:
--   AFTER INSERT trigger on review_jobs fires pg_notify('review_jobs_pending', id),
--   which the worker LISTENs on. Source-agnostic — works no matter what
--   inserts the row.
--
-- Visibility:
--   Closed-beta workspace model: any authenticated user can SELECT every
--   job, review, and chunk. Mutations are owner-only (cancel) or service
--   role (worker writes).
--
-- Idempotent: re-running this file is a no-op.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.review_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  github_login  text not null,
  target        jsonb not null,
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'error', 'cancelled')),
  head_sha      text not null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  error_message text,
  worker_id     text
);

create index if not exists review_jobs_status_idx        on public.review_jobs (status);
create index if not exists review_jobs_created_at_desc_idx on public.review_jobs (created_at desc);
create index if not exists review_jobs_user_id_idx       on public.review_jobs (user_id);

create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null unique references public.review_jobs(id) on delete cascade,
  content    jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.review_chunks (
  id         bigserial primary key,
  job_id     uuid not null references public.review_jobs(id) on delete cascade,
  seq        int not null,
  content    text not null,
  created_at timestamptz not null default now(),
  unique (job_id, seq)
);

create index if not exists review_chunks_job_seq_idx on public.review_chunks (job_id, seq);

-- ---------------------------------------------------------------------------
-- NOTIFY trigger on insert
-- ---------------------------------------------------------------------------

create or replace function public.review_jobs_notify_pending()
returns trigger
language plpgsql
as $$
begin
  -- Worker LISTENs on this channel. Payload is the inserted job's id, which
  -- the worker uses purely as a wake-up hint — claim is still done by SQL
  -- with FOR UPDATE SKIP LOCKED, so a missed NOTIFY (drained on
  -- boot/reconnect) doesn't strand the row.
  perform pg_notify('review_jobs_pending', new.id::text);
  return new;
end;
$$;

drop trigger if exists review_jobs_notify_pending_trg on public.review_jobs;
create trigger review_jobs_notify_pending_trg
  after insert on public.review_jobs
  for each row execute function public.review_jobs_notify_pending();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.review_jobs    enable row level security;
alter table public.reviews        enable row level security;
alter table public.review_chunks  enable row level security;

-- review_jobs ---------------------------------------------------------------

drop policy if exists review_jobs_select_authenticated on public.review_jobs;
create policy review_jobs_select_authenticated on public.review_jobs
  for select to authenticated
  using (true);

drop policy if exists review_jobs_insert_owner on public.review_jobs;
create policy review_jobs_insert_owner on public.review_jobs
  for insert to authenticated
  with check (user_id = auth.uid());

-- Owner can transition their own pending|running job to cancelled. The
-- WITH CHECK clamps the *new* row: status must end at 'cancelled', and
-- cancelled_at must be set. All other update paths (worker status writes,
-- error_message, started_at, etc.) require the service role.
drop policy if exists review_jobs_update_owner_cancel on public.review_jobs;
create policy review_jobs_update_owner_cancel on public.review_jobs
  for update to authenticated
  using (user_id = auth.uid() and status in ('pending', 'running'))
  with check (
    user_id = auth.uid()
    and status = 'cancelled'
    and cancelled_at is not null
  );

-- reviews -------------------------------------------------------------------

drop policy if exists reviews_select_authenticated on public.reviews;
create policy reviews_select_authenticated on public.reviews
  for select to authenticated
  using (true);

-- review_chunks -------------------------------------------------------------

drop policy if exists review_chunks_select_authenticated on public.review_chunks;
create policy review_chunks_select_authenticated on public.review_chunks
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
-- Subscriptions on /jobs/:id need both review_jobs (status updates) and
-- review_chunks (streamed inserts) in the supabase_realtime publication.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_jobs'
  ) then
    execute 'alter publication supabase_realtime add table public.review_jobs';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_chunks'
  ) then
    execute 'alter publication supabase_realtime add table public.review_chunks';
  end if;
end
$$;
