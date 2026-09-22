import { z } from "zod";

export const studyIdSchema = z.string().regex(/^[0-9a-f]{11}$/);
export const frameNameSchema = z.string().regex(/^[0-9]{6}\.(?:jpg|webp)$/);
export const processingStatusSchema = z.enum(["pending", "queued", "processing", "completed", "failed"]);
export const processingStageSchema = z.enum(["queued", "download", "extract", "persist", "finalize", "completed", "failed"]);
export const processingProgressSchema = z.object({
  stage: processingStageSchema,
  percent: z.number().int().min(0).max(100),
  processedFrames: z.number().int().nonnegative().nullable().default(null),
  totalFrames: z.number().int().positive().nullable().default(null),
  startedAt: z.iso.datetime().nullable().default(null),
});
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

export const samplingFpsSchema = z.union([
  z.literal(0.25),
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
  z.literal(5),
]);

export const processingOptionsSchema = z.object({
  fps: samplingFpsSchema.default(0.5),
});

export const VCMR_SCHEMA = "valostudy.vcmr" as const;
export const VCMR_SCHEMA_VERSION = "1.1.0" as const;
export const VCMR_TIMESTAMP_SEMANTICS = "Sampling timeline; timestamps are approximate, not original frame PTS." as const;

export const vcmrFrameIdSchema = z.string().regex(/^frame_[0-9]{6}$/);

export const vcmrTimeRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

export const vcmrTimelineSchema = z.object({
  origin: z.literal("video_start"),
  unit: z.literal("ms"),
  frameOrdering: z.literal("sample_index"),
  durationMs: z.number().int().positive().nullable(),
  samplingIntervalMs: z.number().int().positive(),
  frameCount: z.number().int().nonnegative(),
  observedRange: vcmrTimeRangeSchema.nullable(),
  coverage: z.object({
    expectedFrameCount: z.number().int().nonnegative().nullable(),
    observedFrameCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }),
});

export const vcmrFrameCoreSchema = z.object({
  id: vcmrFrameIdSchema,
  name: frameNameSchema,
  sampleIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  source: z.object({
    kind: z.literal("fixed_rate_sampling"),
    approximateTimestamp: z.literal(true),
  }),
});

export const vcmrFrameSchema = vcmrFrameCoreSchema.extend({
  url: z.string().regex(/^\/[0-9a-f]{11}\/frames\/[0-9]{6}\.(?:jpg|webp)$/),
});

export const vcmrMediaSchema = z.object({
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  sampling: z.object({
    fps: samplingFpsSchema,
    strategy: z.literal("fixed_rate"),
    timestampSemantics: z.literal(VCMR_TIMESTAMP_SEMANTICS),
  }),
});

export const vcmrRoundIdSchema = z.string().regex(/^round_[0-9]{2,3}$/);
export const vcmrRoundSchema = z.object({
  id: vcmrRoundIdSchema,
  number: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
  freezeEndMs: z.number().int().nonnegative().nullable().default(null),
  startFrameId: vcmrFrameIdSchema.nullable().default(null),
  endFrameId: vcmrFrameIdSchema.nullable().default(null),
});

export const vcmrEventSchema = z.object({
  id: z.string().regex(/^event_[0-9]+$/),
  type: z.string().regex(/^[a-z][a-z0-9_]*$/),
  sequence: z.number().int().nonnegative().nullable().default(null),
  timestampMs: z.number().int().nonnegative(),
  endTimestampMs: z.number().int().nonnegative().nullable().default(null),
  roundId: vcmrRoundIdSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceFrameIds: z.array(vcmrFrameIdSchema).default([]),
});

export const vcmrAnnotationSchema = z.object({
  id: z.string().regex(/^annotation_[0-9]+$/),
  kind: z.string().regex(/^[a-z][a-z0-9_]*$/),
  timestampMs: z.number().int().nonnegative().nullable(),
  endTimestampMs: z.number().int().nonnegative().nullable().default(null),
  frameIds: z.array(vcmrFrameIdSchema).default([]),
  text: z.string().trim().min(1).max(12000),
  source: z.enum(["user", "detector", "ai"]),
});

function validateFrameIdentity(
  frames: Array<{ id: string; name: string; sampleIndex: number; timestampMs: number }>,
  ctx: {
    addIssue(issue: { code: "custom"; message: string; path: Array<string | number> }): void;
  },
) {
  const ids = new Set<string>();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const expected = `frame_${frame.name.slice(0, 6)}`;
    if (frame.id !== expected) {
      ctx.addIssue({
        code: "custom",
        message: "Frame ID must be derived from frame name",
        path: ["frames", index, "id"],
      });
    }
    const expectedSampleIndex = Number.parseInt(frame.name.slice(0, 6), 10) - 1;
    if (frame.sampleIndex !== expectedSampleIndex) {
      ctx.addIssue({
        code: "custom",
        message: "sampleIndex must be the zero-based index derived from frame name",
        path: ["frames", index, "sampleIndex"],
      });
    }
    if (index > 0 && frame.timestampMs < frames[index - 1].timestampMs) {
      ctx.addIssue({
        code: "custom",
        message: "Frame timestamps must be monotonic",
        path: ["frames", index, "timestampMs"],
      });
    }
    if (ids.has(frame.id)) {
      ctx.addIssue({
        code: "custom",
        message: "Frame IDs must be unique",
        path: ["frames", index, "id"],
      });
    }
    ids.add(frame.id);
  }
}


function validateTemporalModel(
  value: {
    media: { durationMs: number | null; sampling: { fps: number } };
    timeline: {
      durationMs: number | null;
      samplingIntervalMs: number;
      frameCount: number;
      observedRange: { startMs: number; endMs: number } | null;
      coverage: { expectedFrameCount: number | null; observedFrameCount: number; complete: boolean };
    };
    frames: Array<{ id: string; timestampMs: number }>;
    rounds: Array<{ id: string; startMs: number; endMs: number | null; freezeEndMs: number | null; startFrameId: string | null; endFrameId: string | null }>;
    events: Array<{ timestampMs: number; endTimestampMs: number | null; evidenceFrameIds: string[] }>;
    annotations: Array<{ timestampMs: number | null; endTimestampMs: number | null; frameIds: string[] }>;
  },
  ctx: {
    addIssue(issue: { code: "custom"; message: string; path: Array<string | number> }): void;
  },
) {
  if (value.timeline.durationMs !== value.media.durationMs) {
    ctx.addIssue({ code: "custom", message: "Timeline duration must match media duration", path: ["timeline", "durationMs"] });
  }
  const expectedInterval = Math.round(1000 / value.media.sampling.fps);
  if (value.timeline.samplingIntervalMs !== expectedInterval) {
    ctx.addIssue({ code: "custom", message: "Timeline sampling interval must match media sampling FPS", path: ["timeline", "samplingIntervalMs"] });
  }
  if (value.timeline.frameCount !== value.frames.length || value.timeline.coverage.observedFrameCount !== value.frames.length) {
    ctx.addIssue({ code: "custom", message: "Timeline frame counts must match frames", path: ["timeline", "frameCount"] });
  }
  if (
    value.timeline.coverage.expectedFrameCount !== null
    && value.timeline.coverage.complete !== (value.timeline.coverage.expectedFrameCount === value.frames.length)
  ) {
    ctx.addIssue({ code: "custom", message: "Timeline coverage completeness is inconsistent", path: ["timeline", "coverage", "complete"] });
  }
  const first = value.frames[0]?.timestampMs ?? null;
  const last = value.frames.at(-1)?.timestampMs ?? null;
  const expectedRange = first === null || last === null ? null : { startMs: first, endMs: last };
  if (JSON.stringify(value.timeline.observedRange) !== JSON.stringify(expectedRange)) {
    ctx.addIssue({ code: "custom", message: "Timeline observedRange must match frame timestamps", path: ["timeline", "observedRange"] });
  }
  if (value.timeline.durationMs !== null && last !== null && last > value.timeline.durationMs) {
    ctx.addIssue({ code: "custom", message: "Observed frame timestamps must not exceed media duration", path: ["timeline", "observedRange"] });
  }

  const frameIds = new Set(value.frames.map((frame) => frame.id));
  const roundIds = new Set(value.rounds.map((round) => round.id));
  const canReferenceUnretainedFrame = (frameId: string) => {
    if (frameIds.has(frameId)) return true;
    if (value.frames.length !== 0 || value.timeline.coverage.expectedFrameCount === null) return false;
    const sampleNumber = Number.parseInt(frameId.slice("frame_".length), 10);
    return Number.isInteger(sampleNumber)
      && sampleNumber >= 1
      && sampleNumber <= value.timeline.coverage.expectedFrameCount;
  };
  const durationMs = value.timeline.durationMs;
  for (let index = 0; index < value.rounds.length; index += 1) {
    const round = value.rounds[index];
    if (round.endMs !== null && round.endMs < round.startMs)
      ctx.addIssue({ code: "custom", message: "Round endMs must be at or after startMs", path: ["rounds", index, "endMs"] });
    if (durationMs !== null && round.startMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Round startMs must not exceed media duration", path: ["rounds", index, "startMs"] });
    if (durationMs !== null && round.endMs !== null && round.endMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Round endMs must not exceed media duration", path: ["rounds", index, "endMs"] });
    if (round.freezeEndMs !== null && round.freezeEndMs < round.startMs)
      ctx.addIssue({ code: "custom", message: "Round freezeEndMs must be at or after startMs", path: ["rounds", index, "freezeEndMs"] });
    if (round.endMs !== null && round.freezeEndMs !== null && round.freezeEndMs > round.endMs)
      ctx.addIssue({ code: "custom", message: "Round freezeEndMs must not exceed endMs", path: ["rounds", index, "freezeEndMs"] });
    for (const [key, frameId] of [["startFrameId", round.startFrameId], ["endFrameId", round.endFrameId]] as const) {
      if (frameId !== null && !canReferenceUnretainedFrame(frameId))
        ctx.addIssue({ code: "custom", message: "Round frame reference must exist in the canonical sample space", path: ["rounds", index, key] });
    }
  }

  for (let index = 0; index < value.events.length; index += 1) {
    const event = value.events[index];
    if (event.endTimestampMs !== null && event.endTimestampMs < event.timestampMs)
      ctx.addIssue({ code: "custom", message: "Event endTimestampMs must be at or after timestampMs", path: ["events", index, "endTimestampMs"] });
    if (durationMs !== null && event.timestampMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Event timestampMs must not exceed media duration", path: ["events", index, "timestampMs"] });
    if (durationMs !== null && event.endTimestampMs !== null && event.endTimestampMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Event endTimestampMs must not exceed media duration", path: ["events", index, "endTimestampMs"] });
    if (event.roundId !== null && !roundIds.has(event.roundId))
      ctx.addIssue({ code: "custom", message: "Event roundId must reference an existing round", path: ["events", index, "roundId"] });
    for (const frameId of event.evidenceFrameIds) {
      if (!canReferenceUnretainedFrame(frameId))
        ctx.addIssue({ code: "custom", message: "Event evidence frame reference must exist in the canonical sample space", path: ["events", index, "evidenceFrameIds"] });
    }
  }

  for (let index = 0; index < value.annotations.length; index += 1) {
    const annotation = value.annotations[index];
    if (annotation.timestampMs === null && annotation.endTimestampMs !== null)
      ctx.addIssue({ code: "custom", message: "Annotation endTimestampMs requires timestampMs", path: ["annotations", index, "endTimestampMs"] });
    if (
      annotation.timestampMs !== null
      && annotation.endTimestampMs !== null
      && annotation.endTimestampMs < annotation.timestampMs
    ) {
      ctx.addIssue({ code: "custom", message: "Annotation endTimestampMs must be at or after timestampMs", path: ["annotations", index, "endTimestampMs"] });
    }
    if (durationMs !== null && annotation.timestampMs !== null && annotation.timestampMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Annotation timestampMs must not exceed media duration", path: ["annotations", index, "timestampMs"] });
    if (durationMs !== null && annotation.endTimestampMs !== null && annotation.endTimestampMs > durationMs)
      ctx.addIssue({ code: "custom", message: "Annotation endTimestampMs must not exceed media duration", path: ["annotations", index, "endTimestampMs"] });
    for (const frameId of annotation.frameIds) {
      if (!canReferenceUnretainedFrame(frameId))
        ctx.addIssue({ code: "custom", message: "Annotation frame reference must exist in the canonical sample space", path: ["annotations", index, "frameIds"] });
    }
  }
}

export const vcmrExtractionSchema = z.object({
  schema: z.literal(VCMR_SCHEMA),
  schemaVersion: z.literal(VCMR_SCHEMA_VERSION),
  media: vcmrMediaSchema.extend({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: z.number().int().positive(),
  }),
  timeline: vcmrTimelineSchema,
  frames: z.array(vcmrFrameCoreSchema).max(MAX_EXTRACTED_FRAMES),
  rounds: z.array(vcmrRoundSchema).max(512).default([]),
  events: z.array(vcmrEventSchema).max(250000).default([]),
  annotations: z.array(vcmrAnnotationSchema).max(250000).default([]),
}).superRefine((value, ctx) => {
  validateFrameIdentity(value.frames, ctx);
  validateTemporalModel(value, ctx);
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
  processingProgress: processingProgressSchema.nullable().default(null),
  framesExpiredAt: z.iso.datetime().nullable().default(null),
  frames: z.array(z.object({
    timestampMs: z.number().int().nonnegative(),
    url: z.string().regex(/^\/[0-9a-f]{11}\/frames\/[0-9]{6}\.(?:jpg|webp)$/),
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

export const vcmrMatchSchema = z.object({
  schema: z.literal(VCMR_SCHEMA),
  schemaVersion: z.literal(VCMR_SCHEMA_VERSION),
  study: z.object({
    id: studyIdSchema,
    game: z.literal("valorant"),
    visibility: z.enum(["private", "public"]),
    status: processingStatusSchema,
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  }),
  player: playerSettingsSchema,
  media: vcmrMediaSchema,
  processing: z.object({
    progress: processingProgressSchema.nullable(),
    framesExpiredAt: z.iso.datetime().nullable(),
  }),
  timeline: vcmrTimelineSchema,
  frames: z.array(vcmrFrameSchema).max(MAX_EXTRACTED_FRAMES),
  rounds: z.array(vcmrRoundSchema).max(512).default([]),
  events: z.array(vcmrEventSchema).max(250000).default([]),
  annotations: z.array(vcmrAnnotationSchema).max(250000).default([]),
  coaching: z.object({
    protocol: z.object({
      redditResearchRequired: z.literal(true),
      promptTemplateVersion: z.string().min(1),
    }),
    prompt: z.string().min(1),
  }),
}).superRefine((value, ctx) => {
  validateFrameIdentity(value.frames, ctx);
  validateTemporalModel(value, ctx);
  for (let index = 0; index < value.frames.length; index += 1) {
    if (!value.frames[index].url.startsWith(`/${value.study.id}/frames/`)) {
      ctx.addIssue({
        code: "custom",
        message: "Frame must belong to this Study",
        path: ["frames", index, "url"],
      });
    }
  }
});

export const processingJobSchema = z.object({
  studyId: studyIdSchema,
  sourceObjectKey: z.string().regex(/^studies\/[0-9a-f]{11}\/source$/),
  options: processingOptionsSchema,
}).refine((v) => v.sourceObjectKey === `studies/${v.studyId}/source`, "Source namespace mismatch");

export type PlayerSettings = z.infer<typeof playerSettingsSchema>;
export type ProcessingOptions = z.infer<typeof processingOptionsSchema>;
export type ProcessingProgress = z.infer<typeof processingProgressSchema>;
export type StudyCreation = z.infer<typeof studyCreationSchema>;
export type ProcessingJob = z.infer<typeof processingJobSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type VcmrFrame = z.infer<typeof vcmrFrameSchema>;
export type VcmrMedia = z.infer<typeof vcmrMediaSchema>;
export type VcmrTimeline = z.infer<typeof vcmrTimelineSchema>;
export type VcmrExtraction = z.infer<typeof vcmrExtractionSchema>;
export type VcmrMatch = z.infer<typeof vcmrMatchSchema>;
