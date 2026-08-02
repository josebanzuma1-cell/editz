ALTER TABLE "jobs" DROP CONSTRAINT "jobs_client_has_no_input_key";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "files_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_has_no_input_key" CHECK (("jobs"."execution_mode" = 'server'
             AND ("jobs"."input_key" IS NOT NULL OR "jobs"."files_deleted_at" IS NOT NULL))
          OR ("jobs"."execution_mode" = 'client' AND "jobs"."input_key" IS NULL));