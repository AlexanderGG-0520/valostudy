import { z } from "zod";

export const studyIdSchema = z.string().regex(/^[0-9a-f]{11}$/);
export const frameNameSchema = z.string().regex(/^[0-9]{6}\.webp$/);
export const processingStatusSchema = z.enum(["pending", "queued", "processing", "completed", "failed"]);
export const planSchema = z.enum(["free", "plus", "pro"]);
export type Plan = z.infer<typeof planSchema>;

const GiB = 1024 ** 3;

export const PLAN_LIMITS = {
  free: {
    label: "Free",
    priceUsdMonthly: 0,
    maxUploadBytes: 16 * GiB,
    maxVideoSeconds: 2 * 60 * 60,
    maxFps: 1,
    maxFrames: 7200,
    retentionDays: 30,
    queuePriority: 10,
    cooldownHours: 6,
    rollingWindowDays: null,
    rollingStudyLimit: null,
    publicStudyLimitLabel: "1 Study / 6h cooldown",
    compareLimit: 0,
    clientLimit: 0,
    apiAccess: false,
  },
  plus: {
    label: "Plus",
    priceUsdMonthly: 20,
    maxUploadBytes: 32 * GiB,
    maxVideoSeconds: 2 * 60 * 60,
    maxFps: 2,
    maxFrames: 14400,
    retentionDays: 365,
    queuePriority: 5,
    cooldownHours: null,
    rollingWindowDays: 7,
    rollingStudyLimit: 30,
    publicStudyLimitLabel: "30 Studies / rolling 7 days",
    compareLimit: 20,
    clientLimit: 0,
    apiAccess: false,
  },
  pro: {
    label: "Pro",
    priceUsdMonthly: 200,
    maxUploadBytes: 64 * GiB,
    maxVideoSeconds: 4 * 60 * 60,
    maxFps: 5,
    maxFrames: 72000,
    retentionDays: null,
    queuePriority: 1,
    cooldownHours: null,
    rollingWindowDays: 7,
    // Internal abuse ceiling. The product UI presents Pro as Unlimited.
    rollingStudyLimit: 500,
    publicStudyLimitLabel: "Unlimited Studies (fair use)",
    compareLimit: 100,
    clientLimit: 100,
    apiAccess: true,
  },
} as const satisfies Record<Plan, {
  label: string;
  priceUsdMonthly: number;
  maxUploadBytes: number;
  maxVideoSeconds: number;
  maxFps: number;
  maxFrames: number;
  retentionDays: number | null;
  queuePriority: number;
  cooldownHours: number | null;
  rollingWindowDays: number | null;
  rollingStudyLimit: number | null;
  publicStudyLimitLabel: string;
  compareLimit: number;
  clientLimit: number;
  apiAccess: boolean;
}>;

export function planLimits(plan: Plan) {
  return PLAN_LIMITS[plan];
}

export const MAX_UPLOAD_BYTES = PLAN_LIMITS.pro.maxUploadBytes;
export const PART_BYTES = 16 * 1024 ** 2;
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_UPLOAD_BYTES / PART_BYTES);
export const MAX_VIDEO_SECONDS = PLAN_LIMITS.pro.maxVideoSeconds;
export const MAX_EXTRACTED_FRAMES = PLAN_LIMITS.pro.maxFrames;

export const playerSettingsSchema = z.object({
  rank: z.string().regex(/^(Unranked|Radiant|(Iron|Bronze|Silver|Gold|Platinum|Diamond|Ascendant|Immortal) [1-3])$/),
  sensitivity: z.object({ dpi: z.number().int().min(50).max(64000), inGame: z.number().positive().max(20) }),
  videoSettings: z.object({
    resolution: z.string().regex(/^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/),
    refreshHz: z.number().int().min(30).max(1000),
    fpsLimit: z.number().int().min(0).max(2000),
    vsync: z.boolean(),
    displayMode: z.enum(["fullscreen", "borderless", "windowed"]),
    graphics: z.string().trim().min(1).max(1000),
  }),
  context: z.string().max(6000).default(""),
});

export const processingOptionsSchema = z.object({
  fps: z.union([
    z.literal(0.25),
    z.literal(0.5),
    z.literal(1),
    z.literal(2),
    z.literal(5),
  ]).default(0.5),
});

export const studyCreationSchema = z.object({
  player: playerSettingsSchema,
  visibility: z.enum(["private", "public"]).default("private"),
  video: z.object({
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo"]),
  }),
  processing: processingOptionsSchema,
});

export const promptTemplateSchema = z.object({
  id: z.string().min(1), version: z.string().min(1),
  systemPrompt: z.string().min(1), researchPrompt: z.string().min(1),
  coachingPrompt: z.string().min(1), createdAt: z.iso.datetime(),
});

export const promptSnapshotSchema = z.object({
  templateId: z.string().min(1), templateVersion: z.string().min(1),
  prompt: z.string().min(1), createdAt: z.iso.datetime(),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  studyId: studyIdSchema,
  player: playerSettingsSchema,
  status: processingStatusSchema,
  framesExpiredAt: z.iso.datetime().nullable().default(null),
  frames: z.array(z.object({
    timestampMs: z.number().int().nonnegative(),
    url: z.string().regex(/^\/[0-9a-f]{11}\/frames\/[0-9]{6}\.webp$/),
  })).max(MAX_EXTRACTED_FRAMES),
  timestampNote: z.literal("Sampling timeline; timestamps are approximate, not original frame PTS."),
  coachingProtocol: z.object({
    redditResearchRequired: z.literal(true), promptTemplateVersion: z.string().min(1),
  }),
  prompt: z.string().min(1),
}).superRefine((v, ctx) => {
  if (v.frames.some((f) => !f.url.startsWith(`/${v.studyId}/frames/`)))
    ctx.addIssue({ code: "custom", message: "Frame must belong to this Study", path: ["frames"] });
});

export const processingJobSchema = z.object({
  studyId: studyIdSchema,
  sourceObjectKey: z.string().regex(/^studies\/[0-9a-f]{11}\/source$/),
  options: processingOptionsSchema,
}).refine((v) => v.sourceObjectKey === `studies/${v.studyId}/source`, "Source namespace mismatch");

export type PlayerSettings = z.infer<typeof playerSettingsSchema>;
export type ProcessingOptions = z.infer<typeof processingOptionsSchema>;
export type StudyCreation = z.infer<typeof studyCreationSchema>;
export type ProcessingJob = z.infer<typeof processingJobSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
