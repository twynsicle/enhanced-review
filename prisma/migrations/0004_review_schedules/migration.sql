-- CreateEnum
CREATE TYPE "schedule_status" AS ENUM ('active', 'running', 'paused', 'failed');

-- CreateEnum
CREATE TYPE "schedule_cadence" AS ENUM ('hourly', 'daily', 'weekly');

-- AlterTable
ALTER TABLE "review_jobs" ADD COLUMN     "schedule_id" UUID;

-- CreateTable
CREATE TABLE "review_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target" JSONB NOT NULL,
    "target_key" VARCHAR(255) NOT NULL,
    "cadence" "schedule_cadence" NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "hour_of_day" SMALLINT NOT NULL,
    "status" "schedule_status" NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "last_job_id" UUID,
    "consecutive_failures" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_schedules_status_next_run_at_idx" ON "review_schedules"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "review_schedules_user_id_idx" ON "review_schedules"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_schedules_user_id_target_key_key" ON "review_schedules"("user_id", "target_key");

-- CreateIndex
CREATE INDEX "review_jobs_schedule_id_idx" ON "review_jobs"("schedule_id");

-- AddForeignKey
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "review_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added: constraints Prisma cannot express, in the style of 0001_init.
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_hour_of_day_check" CHECK ("hour_of_day" BETWEEN 0 AND 23);
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_consecutive_failures_check" CHECK ("consecutive_failures" >= 0);
