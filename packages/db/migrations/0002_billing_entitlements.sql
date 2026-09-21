ALTER TABLE "studies" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "frames_expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "study_plan" CHECK ("studies"."plan" in ('free','plus','pro'));--> statement-breakpoint
CREATE INDEX "studies_retention_idx" ON "studies" USING btree ("retention_until");--> statement-breakpoint

CREATE TABLE "study_usage_events" (
  "study_id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "plan" text NOT NULL,
  "consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "study_usage_events" ADD CONSTRAINT "study_usage_events_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_usage_events" ADD CONSTRAINT "study_usage_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_usage_events" ADD CONSTRAINT "study_usage_plan" CHECK ("study_usage_events"."plan" in ('free','plus','pro'));--> statement-breakpoint
CREATE INDEX "study_usage_owner_consumed_idx" ON "study_usage_events" USING btree ("owner_id","consumed_at");--> statement-breakpoint

CREATE TABLE "billing_subscriptions" (
  "user_id" text PRIMARY KEY NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "plan" text DEFAULT 'free' NOT NULL,
  "status" text DEFAULT 'inactive' NOT NULL,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
  CONSTRAINT "billing_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_plan" CHECK ("billing_subscriptions"."plan" in ('free','plus','pro'));--> statement-breakpoint

CREATE TABLE "stripe_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
