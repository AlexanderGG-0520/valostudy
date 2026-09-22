import {
  db, studies, uploads, jobs, promptTemplates, promptSnapshots, frames, usageEvents, user,
  eq, asc, and, desc, gte, isNull, sql,
} from "@valostudy/db";
import { insertWithStudyId } from "@valostudy/db/id";
import { template, renderSnapshot } from "@valostudy/prompts";
import {
  manifestSchema, vcmrMatchSchema, studyIdSchema, PLAN_LIMITS,
  VCMR_SCHEMA, VCMR_SCHEMA_VERSION, VCMR_TIMESTAMP_SEMANTICS,
  type Plan, type StudyCreation,
} from "@valostudy/schema";
import { Storage, sourceKey } from "@valostudy/storage";
import { HttpError } from "./http";
import { assertPlanInput, billingStatus } from "./billing";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function createStudy(ownerId: string, input: StudyCreation) {
  const entitlement = await billingStatus(ownerId);
  const plan = entitlement.plan;
  if (!entitlement.usage.canCreate) {
    throw new HttpError(429, entitlement.usage.nextAvailableAt
      ? `Study limit active until ${entitlement.usage.nextAvailableAt}`
      : "Study limit reached");
  }
  assertPlanInput(plan, input);

  const result = await db().transaction(async (tx) => {
    await tx.insert(promptTemplates).values({ ...template, createdAt: new Date(template.createdAt) }).onConflictDoNothing();
    const [savedTemplate] = await tx.select().from(promptTemplates)
      .where(and(eq(promptTemplates.id, template.id), eq(promptTemplates.version, template.version)));
    const snapshot = renderSnapshot(input, { ...savedTemplate, createdAt: savedTemplate.createdAt.toISOString() });
    const study = await insertWithStudyId(async (id) => {
      const [row] = await tx.insert(studies).values({
        id,
        ownerId,
        plan,
        player: input.player,
        options: input.processing,
        visibility: input.visibility,
      }).onConflictDoNothing({ target: studies.id }).returning();
      return row;
    });
    await tx.insert(promptSnapshots).values({
      studyId: study.id,
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
    });
    return study;
  });

  const storage = new Storage();
  let uploadId: string | undefined;
  try {
    uploadId = await storage.create(sourceKey(result.id), input.video.mimeType);
    await db().insert(uploads).values({
      studyId: result.id,
      objectKey: sourceKey(result.id),
      uploadId,
      expectedBytes: input.video.size,
      expiresAt: new Date(Date.now() + 4 * HOUR),
    });
  } catch (e) {
    if (uploadId) await storage.abort(sourceKey(result.id), uploadId).catch(() => undefined);
    await db().update(studies).set({ status: "failed" }).where(eq(studies.id, result.id));
    throw e;
  }
  return result;
}

export async function readableStudy(id: string, viewerId?: string) {
  if (!studyIdSchema.safeParse(id).success) return null;
  const [row] = await db().select().from(studies).where(eq(studies.id, id));
  if (!row || (row.visibility === "private" && row.ownerId !== viewerId)) return null;
  return row;
}

export async function buildCanonicalMatch(id: string, viewerId?: string) {
  const study = await readableStudy(id, viewerId);
  if (!study) throw new HttpError(404, "Study not found");

  const [[snapshot], [job], [upload], rows] = await Promise.all([
    db().select().from(promptSnapshots).where(eq(promptSnapshots.studyId, id)),
    db().select({ progress: jobs.progress }).from(jobs).where(eq(jobs.studyId, id)),
    db().select({ metadata: uploads.metadata }).from(uploads).where(eq(uploads.studyId, id)),
    study.status === "completed" && !study.framesExpiredAt
      ? db().select().from(frames).where(eq(frames.studyId, id)).orderBy(asc(frames.name))
      : Promise.resolve([]),
  ]);
  if (!snapshot) throw new Error("Missing prompt snapshot");

  return vcmrMatchSchema.parse({
    schema: VCMR_SCHEMA,
    schemaVersion: VCMR_SCHEMA_VERSION,
    study: {
      id,
      game: "valorant",
      visibility: study.visibility,
      status: study.status,
      createdAt: study.createdAt.toISOString(),
      completedAt: study.completedAt?.toISOString() ?? null,
    },
    player: study.player,
    media: {
      width: upload?.metadata?.width ?? null,
      height: upload?.metadata?.height ?? null,
      durationMs: upload?.metadata?.duration
        ? Math.round(upload.metadata.duration * 1000)
        : null,
      sampling: {
        fps: study.options.fps,
        strategy: "fixed_rate",
        timestampSemantics: VCMR_TIMESTAMP_SEMANTICS,
      },
    },
    processing: {
      progress: job?.progress ?? null,
      framesExpiredAt: study.framesExpiredAt?.toISOString() ?? null,
    },
    frames: rows.map((frame) => ({
      id: `frame_${frame.name.slice(0, 6)}`,
      name: frame.name,
      timestampMs: frame.timestampMs,
      url: `/${id}/frames/${frame.name}`,
      source: {
        kind: "fixed_rate_sampling",
        approximateTimestamp: true,
      },
    })),
    rounds: [],
    events: [],
    annotations: [],
    coaching: {
      protocol: {
        redditResearchRequired: true,
        promptTemplateVersion: snapshot.templateVersion,
      },
      prompt: snapshot.prompt,
    },
  });
}

export async function buildManifest(id: string, viewerId?: string) {
  const canonical = await buildCanonicalMatch(id, viewerId);
  return manifestSchema.parse({
    schemaVersion: 1,
    studyId: canonical.study.id,
    player: canonical.player,
    status: canonical.study.status,
    processingProgress: canonical.processing.progress,
    framesExpiredAt: canonical.processing.framesExpiredAt,
    frames: canonical.frames.map((frame) => ({
      timestampMs: frame.timestampMs,
      url: frame.url,
    })),
    timestampNote: VCMR_TIMESTAMP_SEMANTICS,
    coachingProtocol: canonical.coaching.protocol,
    prompt: canonical.coaching.prompt,
  });
}

export async function buildPublicAiStudyIndex(id: string) {
  const study = await readableStudy(id);
  if (!study) throw new HttpError(404, "Study not found");

  const [[snapshot], countRows] = await Promise.all([
    db().select().from(promptSnapshots).where(eq(promptSnapshots.studyId, id)),
    study.status === "completed" && !study.framesExpiredAt
      ? db().select({ count: sql<number>`count(*)` }).from(frames).where(eq(frames.studyId, id))
      : Promise.resolve([{ count: 0 }]),
  ]);
  if (!snapshot) throw new Error("Missing prompt snapshot");

  return {
    studyId: id,
    player: study.player,
    status: study.status,
    framesExpiredAt: study.framesExpiredAt?.toISOString() ?? null,
    frameCount: Number(countRows[0]?.count ?? 0),
    timestampNote: VCMR_TIMESTAMP_SEMANTICS,
    coachingProtocol: {
      redditResearchRequired: true,
      promptTemplateVersion: snapshot.templateVersion,
    },
    prompt: snapshot.prompt,
  };
}

export async function buildPublicAiFramePage(id: string, offset: number, limit: number) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 240)
    throw new HttpError(400, "Invalid frame pagination");

  const study = await readableStudy(id);
  if (!study || study.status !== "completed" || study.framesExpiredAt)
    throw new HttpError(404, "Frames not found");

  const [[totalRow], rows] = await Promise.all([
    db().select({ count: sql<number>`count(*)` }).from(frames).where(eq(frames.studyId, id)),
    db().select({ name: frames.name, timestampMs: frames.timestampMs })
      .from(frames)
      .where(eq(frames.studyId, id))
      .orderBy(asc(frames.name))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    studyId: id,
    total: Number(totalRow?.count ?? 0),
    timestampNote: VCMR_TIMESTAMP_SEMANTICS,
    frames: rows.map((frame) => ({
      name: frame.name,
      timestampMs: frame.timestampMs,
      url: `/${id}/frames/${frame.name}`,
    })),
  };
}

export async function ownedUpload(id: string, ownerId: string) {
  studyIdSchema.parse(id);
  const [row] = await db().select({ study: studies, upload: uploads }).from(studies)
    .innerJoin(uploads, eq(uploads.studyId, studies.id))
    .where(eq(studies.id, id));
  if (!row || row.study.ownerId !== ownerId) throw new HttpError(404, "Upload not found");
  return row.upload;
}

async function assertUsageAvailable(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  ownerId: string,
  plan: Plan,
  now: Date,
) {
  const limits = PLAN_LIMITS[plan];

  if (plan === "free") {
    const cutoff = new Date(now.getTime() - limits.cooldownHours! * HOUR);
    const [recent] = await tx.select().from(usageEvents).where(and(
      eq(usageEvents.ownerId, ownerId),
      eq(usageEvents.plan, plan),
      isNull(usageEvents.releasedAt),
      gte(usageEvents.consumedAt, cutoff),
    )).orderBy(desc(usageEvents.consumedAt)).limit(1);

    if (recent) {
      const next = new Date(recent.consumedAt.getTime() + limits.cooldownHours! * HOUR);
      throw new HttpError(429, `Free cooldown active until ${next.toISOString()}`);
    }
    return;
  }

  const windowStart = new Date(now.getTime() - limits.rollingWindowDays! * DAY);
  const recent = await tx.select({ consumedAt: usageEvents.consumedAt }).from(usageEvents).where(and(
    eq(usageEvents.ownerId, ownerId),
    eq(usageEvents.plan, plan),
    isNull(usageEvents.releasedAt),
    gte(usageEvents.consumedAt, windowStart),
  )).orderBy(usageEvents.consumedAt);

  if (limits.rollingStudyLimit !== null && recent.length >= limits.rollingStudyLimit) {
    const next = new Date(recent[0].consumedAt.getTime() + limits.rollingWindowDays! * DAY);
    throw new HttpError(429, plan === "pro"
      ? "Pro fair-use limit reached; contact support if this is legitimate high-volume use"
      : `Weekly Study limit reached until ${next.toISOString()}`);
  }
}

export async function enqueueCompletedUpload(id: string, ownerId: string) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select({ study: studies, upload: uploads }).from(studies)
      .innerJoin(uploads, eq(uploads.studyId, studies.id))
      .where(eq(studies.id, id))
      .for("update");

    if (!row || row.study.ownerId !== ownerId) throw new HttpError(404, "Upload not found");
    const u = row.upload;
    if (u.completedAt) return;
    if (u.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload expired");

    // Serialize quota consumption per account so concurrent completes cannot bypass limits.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("update");
    const now = new Date();
    await assertUsageAvailable(tx, ownerId, row.study.plan, now);

    const storage = new Storage();
    let object = await storage.head(u.objectKey);
    if (!object) {
      const { partSize } = await import("@valostudy/storage");
      const { PART_BYTES } = await import("@valostudy/schema");
      const parts = await storage.parts(u.objectKey, u.uploadId);
      if (parts.length !== Math.ceil(u.expectedBytes / PART_BYTES) ||
          parts.some((p, i) => p.PartNumber !== i + 1 || !p.ETag || p.Size !== partSize(u.expectedBytes, i + 1)))
        throw new HttpError(400, "Incomplete upload or part size mismatch");
      await storage.complete(u.objectKey, u.uploadId, parts);
      object = await storage.head(u.objectKey);
    }

    if (object?.ContentLength !== u.expectedBytes) {
      await storage.delete(u.objectKey);
      throw new HttpError(400, "Uploaded size mismatch");
    }

    await tx.insert(usageEvents).values({
      studyId: id,
      ownerId,
      plan: row.study.plan,
      consumedAt: now,
    }).onConflictDoNothing();

    await tx.update(uploads).set({ completedAt: now }).where(eq(uploads.studyId, id));
    await tx.insert(jobs).values({
      studyId: id,
      status: "pending",
      progress: { stage: "queued", percent: 0, processedFrames: null, totalFrames: null, startedAt: null },
    }).onConflictDoNothing();
    await tx.update(studies).set({ status: "queued" }).where(eq(studies.id, id));
  });
}
