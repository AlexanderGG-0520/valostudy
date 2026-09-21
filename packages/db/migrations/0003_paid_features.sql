CREATE TABLE "study_comparisons" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "visibility" text DEFAULT 'private' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "comparison_id_format" CHECK ("study_comparisons"."id" ~ '^[0-9a-f]{11}$'),
  CONSTRAINT "comparison_visibility" CHECK ("study_comparisons"."visibility" in ('private','public'))
);--> statement-breakpoint
ALTER TABLE "study_comparisons" ADD CONSTRAINT "study_comparisons_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "comparison_studies" (
  "comparison_id" text NOT NULL,
  "study_id" text NOT NULL,
  "position" integer NOT NULL,
  CONSTRAINT "comparison_studies_comparison_id_study_id_pk" PRIMARY KEY("comparison_id","study_id")
);--> statement-breakpoint
ALTER TABLE "comparison_studies" ADD CONSTRAINT "comparison_studies_comparison_id_study_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."study_comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_studies" ADD CONSTRAINT "comparison_studies_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comparison_studies_position_idx" ON "comparison_studies" USING btree ("comparison_id","position");--> statement-breakpoint

CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");
