CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "allowed_users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_users_github_login_unique" UNIQUE("github_login")
);
--> statement-breakpoint
CREATE TABLE "review_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"github_login" text NOT NULL,
	"target" jsonb NOT NULL,
	"status" "job_status" NOT NULL,
	"head_sha" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"error_message" text,
	"risk_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"diff_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"github_login" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_chunks" ADD CONSTRAINT "review_chunks_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_review_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."review_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_chunks_job_seq_unique" ON "review_chunks" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "review_jobs_status_idx" ON "review_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_jobs_user_idx" ON "review_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_jobs_created_idx" ON "review_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_login_unique" ON "users" USING btree ("github_login");