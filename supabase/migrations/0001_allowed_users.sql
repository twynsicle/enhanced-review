-- Phase 1: invite-only allowlist.
--
-- Auth flow: middleware checks whether the GitHub login on the Supabase
-- session is present in this table. Missing → sign out + redirect to /denied.
--
-- Server-only table: no RLS policy is defined, which means RLS-enabled clients
-- (anon, authenticated) cannot read it. Lookups go through the service role
-- key from the Next.js server.

create extension if not exists pgcrypto;

create table if not exists public.allowed_users (
  github_login text primary key,
  created_at   timestamptz not null default now()
);

alter table public.allowed_users enable row level security;

-- Seed the operator. Idempotent so re-running the migration is safe.
insert into public.allowed_users (github_login)
values ('twynsicle')
on conflict (github_login) do nothing;
