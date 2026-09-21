import {
  pgTable, text, boolean, timestamp, jsonb, bigint, integer, primaryKey,
  check, foreignKey, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Plan, PlayerSettings, ProcessingOptions, ProcessingProgress } from "@valostudy/schema";

const time = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
  termsAccepted: boolean("terms_accepted").notNull().default(false),
  privacyAccepted: boolean("privacy_accepted").notNull().default(false),
  legalAcceptedAt: time("legal_accepted_at"),
  legalVersion: text("legal_version"),
});

export const session = pgTable("sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: time("access_token_expires_at"),
  refreshTokenExpiresAt: time("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});


export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: time("created_at"),
  aaguid: text("aaguid"),
}, (t) => [
  index("passkey_userId_idx").on(t.userId),
  index("passkey_credentialID_idx").on(t.credentialID),
]);

export const studies = pgTable("studies", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  status: text("status", { enum: ["pending", "queued", "processing", "completed", "failed"] }).notNull().default("pending"),
  plan: text("plan", { enum: ["free", "plus", "pro"] }).$type<Plan>().notNull().default("free"),
  player: jsonb("player").$type<PlayerSettings>().notNull(),
  options: jsonb("options").$type<ProcessingOptions>().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  completedAt: time("completed_at"),
  retentionUntil: time("retention_until"),
  framesExpiredAt: time("frames_expired_at"),
}, (t) => [
  check("study_id_format", sql`${t.id} ~ '^[0-9a-f]{11}$'`),
  check("study_visibility", sql`${t.visibility} in ('private','public')`),
  check("study_status", sql`${t.status} in ('pending','queued','processing','completed','failed')`),
  check("study_plan", sql`${t.plan} in ('free','plus','pro')`),
  index("studies_retention_idx").on(t.retentionUntil),
]);

export const uploads = pgTable("video_uploads", {
  studyId: text("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull().unique(),
  uploadId: text("upload_id").notNull(),
  expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
  expiresAt: time("expires_at").notNull(),
  completedAt: time("completed_at"),
  metadata: jsonb("metadata").$type<{ width: number; height: number; duration: number }>(),
});

export const jobs = pgTable("processing_jobs", {
  studyId: text("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "queued", "processing", "completed", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  progress: jsonb("progress").$type<ProcessingProgress>(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => [
  check("job_status", sql`${t.status} in ('pending','queued','processing','completed','failed')`),
  index("processing_jobs_status_idx").on(t.status),
]);

export const frames = pgTable("extracted_frames", {
  studyId: text("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timestampMs: integer("timestamp_ms").notNull(),
  objectKey: text("object_key").notNull(),
}, (t) => [primaryKey({ columns: [t.studyId, t.name] })]);

export const usageEvents = pgTable("study_usage_events", {
  studyId: text("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "plus", "pro"] }).$type<Plan>().notNull(),
  consumedAt: time("consumed_at").notNull().defaultNow(),
  releasedAt: time("released_at"),
}, (t) => [
  check("study_usage_plan", sql`${t.plan} in ('free','plus','pro')`),
  index("study_usage_owner_consumed_idx").on(t.ownerId, t.consumedAt),
]);

export const billingSubscriptions = pgTable("billing_subscriptions", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: text("plan", { enum: ["free", "plus", "pro"] }).$type<Plan>().notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: time("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => [
  check("billing_plan", sql`${t.plan} in ('free','plus','pro')`),
]);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: time("processed_at").notNull().defaultNow(),
});

export const billingCheckoutIntents = pgTable("billing_checkout_intents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["plus", "pro"] }).$type<Exclude<Plan, "free">>().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
}, (t) => [
  check("billing_checkout_intent_plan", sql`${t.plan} in ('plus','pro')`),
  index("billing_checkout_intents_user_idx").on(t.userId, t.createdAt),
]);

export const coachClients = pgTable("coach_clients", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  riotId: text("riot_id"),
  notes: text("notes").notNull().default(""),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [
  check("coach_client_id_format", sql`${t.id} ~ '^[0-9a-f]{11}$'`),
  index("coach_clients_owner_idx").on(t.ownerId, t.createdAt),
]);

export const studyClientAssignments = pgTable("study_client_assignments", {
  studyId: text("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => coachClients.id, { onDelete: "cascade" }),
  assignedAt: time("assigned_at").notNull().defaultNow(),
}, (t) => [
  index("study_client_assignments_client_idx").on(t.clientId, t.assignedAt),
]);

export const studyComparisons = pgTable("study_comparisons", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [
  check("comparison_id_format", sql`${t.id} ~ '^[0-9a-f]{11}$'`),
  check("comparison_visibility", sql`${t.visibility} in ('private','public')`),
]);

export const comparisonStudies = pgTable("comparison_studies", {
  comparisonId: text("comparison_id").notNull().references(() => studyComparisons.id, { onDelete: "cascade" }),
  studyId: text("study_id").notNull().references(() => studies.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [
  primaryKey({ columns: [t.comparisonId, t.studyId] }),
  index("comparison_studies_position_idx").on(t.comparisonId, t.position),
]);

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
  lastUsedAt: time("last_used_at"),
  revokedAt: time("revoked_at"),
}, (t) => [
  index("api_keys_user_idx").on(t.userId),
]);

export const promptTemplates = pgTable("prompt_templates", {
  id: text("id").notNull(),
  version: text("version").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  researchPrompt: text("research_prompt").notNull(),
  coachingPrompt: text("coaching_prompt").notNull(),
  createdAt: time("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const promptSnapshots = pgTable("prompt_snapshots", {
  studyId: text("study_id").primaryKey().references(() => studies.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  templateVersion: text("template_version").notNull(),
  prompt: text("prompt").notNull(),
  createdAt: time("created_at").notNull(),
}, (t) => [foreignKey({
  columns: [t.templateId, t.templateVersion],
  foreignColumns: [promptTemplates.id, promptTemplates.version],
})]);
