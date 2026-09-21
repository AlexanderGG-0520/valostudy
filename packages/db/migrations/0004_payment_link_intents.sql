CREATE TABLE "billing_checkout_intents" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "plan" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  CONSTRAINT "billing_checkout_intent_plan" CHECK ("billing_checkout_intents"."plan" in ('plus','pro'))
);--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_checkout_intents_user_idx" ON "billing_checkout_intents" USING btree ("user_id","created_at");
