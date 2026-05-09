import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { NarrativeReview } from '@enhanced-review/review-types';

// --- Auth.js v5 standard tables ---------------------------------------------
// Schema follows https://authjs.dev/getting-started/adapters/drizzle. Column
// names match the adapter's expectations (snake_case for OAuth provider
// fields). The `users` table is extended with `github_login` to keep the
// app-domain identifier next to the auth identity.

export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    email: text('email').unique(),
    emailVerified: timestamp('email_verified', { mode: 'date' }),
    image: text('image'),
    githubLogin: text('github_login'),
  },
  (t) => [uniqueIndex('users_github_login_unique').on(t.githubLogin)],
);

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// --- App tables -------------------------------------------------------------

export const allowedUsers = pgTable('allowed_users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  githubLogin: text('github_login').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobStatus = pgEnum('job_status', [
  'pending',
  'running',
  'done',
  'error',
  'cancelled',
]);

export const reviewJobs = pgTable(
  'review_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubLogin: text('github_login').notNull(),
    target: jsonb('target').notNull().$type<ReviewTarget>(),
    status: jobStatus('status').notNull(),
    headSha: text('head_sha'),
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { mode: 'date', withTimezone: true }),
    errorMessage: text('error_message'),
    riskScore: integer('risk_score'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('review_jobs_status_idx').on(t.status),
    index('review_jobs_user_idx').on(t.userId),
    index('review_jobs_created_idx').on(t.createdAt),
  ],
);

export const reviews = pgTable('reviews', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  jobId: text('job_id')
    .notNull()
    .unique()
    .references(() => reviewJobs.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull().$type<NarrativeReview>(),
  diffTruncated: boolean('diff_truncated').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reviewChunks = pgTable(
  'review_chunks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    jobId: text('job_id')
      .notNull()
      .references(() => reviewJobs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('review_chunks_job_seq_unique').on(t.jobId, t.seq)],
);
