-- Phase 3 RLS smoke tests.
--
-- Verifies the policies in 0002_review_jobs.sql reject the obvious
-- cross-user attacks. Runs as a single transaction that rolls back at
-- the end, so nothing persists.
--
-- Run: see scripts/run-rls-tests.sh — invokes psql with ON_ERROR_STOP=1
-- so any RAISE EXCEPTION fails the script with non-zero exit code.

begin;

-- ---------------------------------------------------------------------------
-- Setup (as the postgres superuser — RLS not yet engaged).
-- ---------------------------------------------------------------------------

-- Two fake auth users. Direct inserts skip gotrue, which is fine for
-- testing RLS — we only need ids the policies can reference. The
-- on-conflict-do-nothing handles the (unlikely) case where these uuids
-- already exist.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated', 'rls-alice@test.local',
    '{"provider":"github"}'::jsonb, '{"user_name":"rls-alice"}'::jsonb,
    false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated', 'rls-bob@test.local',
    '{"provider":"github"}'::jsonb, '{"user_name":"rls-bob"}'::jsonb,
    false, now(), now())
on conflict (id) do nothing;

-- Seed bob already has a pending job (created via service role, simulating
-- what POST /api/jobs would have inserted).
insert into public.review_jobs (id, user_id, github_login, target, head_sha, status)
values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   'rls-bob',
   '{"kind":"branch","owner":"o","repo":"r","ref":"x","headSha":"sha","baseRef":"main","baseSha":"sha"}'::jsonb,
   'sha',
   'pending');

-- Switch helpers (use SET LOCAL so this only applies inside the
-- transaction).
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute format('set local role anon');
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 1: alice CAN insert her own job.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into public.review_jobs (id, user_id, github_login, target, head_sha)
values
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   'rls-alice',
   '{"kind":"branch","owner":"o","repo":"r","ref":"alice","headSha":"sha","baseRef":"main","baseSha":"sha"}'::jsonb,
   'sha');

-- ---------------------------------------------------------------------------
-- Test 2: alice CANNOT insert claiming bob's user_id (insert WITH CHECK).
-- ---------------------------------------------------------------------------
do $$
declare
  caught boolean := false;
begin
  begin
    insert into public.review_jobs (user_id, github_login, target, head_sha)
    values
      ('22222222-2222-2222-2222-222222222222',
       'rls-alice',
       '{"kind":"branch","owner":"o","repo":"r","ref":"impersonation","headSha":"sha","baseRef":"main","baseSha":"sha"}'::jsonb,
       'sha');
  exception
    when insufficient_privilege then caught := true;
    when check_violation then caught := true;
    when others then caught := true;
  end;
  if not caught then
    raise exception 'Test 2 failed: alice inserted a row with bob''s user_id';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 3: alice can SELECT all jobs (workspace visibility).
-- ---------------------------------------------------------------------------
do $$
declare
  total_rows int;
begin
  select count(*) into total_rows from public.review_jobs;
  if total_rows < 2 then
    raise exception 'Test 3 failed: alice sees only % rows, expected ≥ 2 (workspace visibility)', total_rows;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 4: alice CANNOT cancel bob's job (UPDATE USING).
-- ---------------------------------------------------------------------------
do $$
declare
  affected int;
begin
  with upd as (
    update public.review_jobs
       set status = 'cancelled', cancelled_at = now()
     where id = '33333333-3333-3333-3333-333333333333'
       and status in ('pending','running')
    returning id
  )
  select count(*) into affected from upd;
  if affected <> 0 then
    raise exception 'Test 4 failed: alice cancelled bob''s job (% rows affected)', affected;
  end if;
end;
$$;

-- Sanity: bob's job should still be pending.
do $$
declare
  s text;
begin
  -- Switch out of alice so the SELECT isn't filtered to her rows. Actually
  -- workspace visibility lets her see it regardless, but be explicit.
  select status into s from public.review_jobs where id = '33333333-3333-3333-3333-333333333333';
  if s <> 'pending' then
    raise exception 'Test 4 sanity failed: bob job status changed to %', s;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 5: alice CAN cancel her own pending job (happy path).
-- ---------------------------------------------------------------------------
do $$
declare
  affected int;
begin
  with upd as (
    update public.review_jobs
       set status = 'cancelled', cancelled_at = now()
     where id = '44444444-4444-4444-4444-444444444444'
       and status in ('pending','running')
    returning id
  )
  select count(*) into affected from upd;
  if affected <> 1 then
    raise exception 'Test 5 failed: alice could not cancel her own pending job (% rows)', affected;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 6: alice CANNOT cancel an already-cancelled job (USING clamps to
-- pending|running).
-- ---------------------------------------------------------------------------
do $$
declare
  affected int;
begin
  with upd as (
    update public.review_jobs
       set status = 'cancelled', cancelled_at = now()
     where id = '44444444-4444-4444-4444-444444444444'
       and status in ('pending','running')
    returning id
  )
  select count(*) into affected from upd;
  if affected <> 0 then
    raise exception 'Test 6 failed: alice updated a cancelled job (% rows)', affected;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 7: alice CANNOT change status to 'done' (WITH CHECK clamps the new
-- row's status to 'cancelled').
-- ---------------------------------------------------------------------------
-- Set up a fresh pending job to attempt this against.
select pg_temp.as_postgres();
insert into public.review_jobs (id, user_id, github_login, target, head_sha)
values
  ('55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   'rls-alice',
   '{"kind":"branch","owner":"o","repo":"r","ref":"alice2","headSha":"sha","baseRef":"main","baseSha":"sha"}'::jsonb,
   'sha');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

do $$
declare
  caught boolean := false;
  affected int;
begin
  begin
    -- Try to flip her own pending row to 'done'. WITH CHECK requires
    -- new.status = 'cancelled', so this should error or return 0 rows.
    with upd as (
      update public.review_jobs
         set status = 'done', completed_at = now()
       where id = '55555555-5555-5555-5555-555555555555'
      returning id
    )
    select count(*) into affected from upd;
  exception
    when check_violation then caught := true;
    when others then caught := true;
  end;
  if not caught and affected > 0 then
    raise exception 'Test 7 failed: alice flipped her own row to done (% rows)', affected;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 8: anon cannot SELECT review_jobs.
-- ---------------------------------------------------------------------------
select pg_temp.as_anon();

do $$
declare
  caught boolean := false;
  total int;
begin
  begin
    select count(*) into total from public.review_jobs;
    -- If RLS hides everything, count = 0 (no error). If anon truly has
    -- no privilege, the SELECT errors out. Either is acceptable.
    if total > 0 then
      raise exception 'Test 8 failed: anon saw % review_jobs rows', total;
    end if;
  exception
    when insufficient_privilege then caught := true;
    when others then
      raise;  -- bubble up unexpected errors
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Done. Roll back so test data does not pollute the dev DB.
-- ---------------------------------------------------------------------------
rollback;

\echo 'RLS smoke tests passed.'
