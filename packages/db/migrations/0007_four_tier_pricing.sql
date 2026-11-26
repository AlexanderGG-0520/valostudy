ALTER TABLE "studies" DROP CONSTRAINT "study_plan";--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "study_plan" CHECK ("studies"."plan" in ('free','plus','pro','coach'));--> statement-breakpoint
ALTER TABLE "study_usage_events" DROP CONSTRAINT "study_usage_plan";--> statement-breakpoint
ALTER TABLE "study_usage_events" ADD CONSTRAINT "study_usage_plan" CHECK ("study_usage_events"."plan" in ('free','plus','pro','coach'));--> statement-breakpoint
ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "billing_plan";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_plan" CHECK ("billing_subscriptions"."plan" in ('free','plus','pro','coach'));--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" DROP CONSTRAINT "billing_checkout_intent_plan";--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intent_plan" CHECK ("billing_checkout_intents"."plan" in ('plus','pro','coach'));--> statement-breakpoint
UPDATE "billing_subscriptions" SET "plan" = 'coach' WHERE "plan" = 'pro';--> statement-breakpoint
UPDATE "studies" SET "plan" = 'coach' WHERE "plan" = 'pro';--> statement-breakpoint
UPDATE "study_usage_events" SET "plan" = 'coach' WHERE "plan" = 'pro';--> statement-breakpoint
UPDATE "billing_checkout_intents" SET "expires_at" = now() WHERE "consumed_at" IS NULL AND "expires_at" > now();
