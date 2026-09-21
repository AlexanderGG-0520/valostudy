import { db, studies, uploads, jobs, promptTemplates, promptSnapshots, frames, eq, asc, and } from "@valostudy/db";
import { insertWithStudyId } from "@valostudy/db/id";
import { template, renderSnapshot } from "@valostudy/prompts";
import { manifestSchema, studyIdSchema, type StudyCreation } from "@valostudy/schema";
import { Storage, sourceKey } from "@valostudy/storage";
import { HttpError } from "./http";
export async function createStudy(ownerId: string, input: StudyCreation) {
  const result = await db().transaction(async (tx) => {
    await tx.insert(promptTemplates).values({ ...template, createdAt: new Date(template.createdAt) }).onConflictDoNothing();
    const [savedTemplate] = await tx.select().from(promptTemplates)
      .where(and(eq(promptTemplates.id, template.id), eq(promptTemplates.version, template.version)));
    const snapshot = renderSnapshot(input, { ...savedTemplate, createdAt: savedTemplate.createdAt.toISOString() });
    // Only the Study primary-key conflict is retried; no failed transaction is reused.
    const study = await insertWithStudyId(async (id) => {
      const [row] = await tx.insert(studies).values({
        id, ownerId, player: input.player, options: input.processing, visibility: input.visibility,
      }).onConflictDoNothing({ target: studies.id }).returning();
      return row;
    });
    await tx.insert(promptSnapshots).values({
      studyId: study.id, ...snapshot, createdAt: new Date(snapshot.createdAt),
    });
    return study;
  });
  const storage = new Storage();
  let uploadId: string | undefined;
  try {
    uploadId = await storage.create(sourceKey(result.id), input.video.mimeType);
    await db().insert(uploads).values({
      studyId: result.id, objectKey: sourceKey(result.id), uploadId,
      expectedBytes: input.video.size, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
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
export async function buildManifest(id: string, viewerId?: string) {
  const study = await readableStudy(id, viewerId);
  if (!study) throw new HttpError(404, "Study not found");
  const [snapshot] = await db().select().from(promptSnapshots).where(eq(promptSnapshots.studyId, id));
  if (!snapshot) throw new Error("Missing prompt snapshot");
  const rows = study.status === "completed"
    ? await db().select().from(frames).where(eq(frames.studyId, id)).orderBy(asc(frames.name)) : [];
  return manifestSchema.parse({
    schemaVersion: 1, studyId: id, player: study.player, status: study.status,
    frames: rows.map((f) => ({ timestampMs: f.timestampMs, url: `/${id}/frames/${f.name}` })),
    timestampNote: "Sampling timeline; timestamps are approximate, not original frame PTS.",
    coachingProtocol: { redditResearchRequired: true, promptTemplateVersion: snapshot.templateVersion },
    prompt: snapshot.prompt,
  });
}
export async function ownedUpload(id: string, ownerId: string) {
  studyIdSchema.parse(id);
  const [row] = await db().select({ study: studies, upload: uploads }).from(studies)
    .innerJoin(uploads, eq(uploads.studyId, studies.id)).where(eq(studies.id, id));
  if (!row || row.study.ownerId !== ownerId) throw new HttpError(404, "Upload not found");
  return row.upload;
}
export async function enqueueCompletedUpload(id: string, ownerId: string) {
  // Serialize complete requests. HEAD handles a crash after S3 complete but before the DB commit.
  return db().transaction(async (tx) => {
    const [row] = await tx.select({ study: studies, upload: uploads }).from(studies)
      .innerJoin(uploads, eq(uploads.studyId, studies.id)).where(eq(studies.id, id)).for("update");
    if (!row || row.study.ownerId !== ownerId) throw new HttpError(404, "Upload not found");
    const u = row.upload;
    if (u.completedAt) return;
    if (u.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload expired");
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
    await tx.update(uploads).set({ completedAt: new Date() }).where(eq(uploads.studyId, id));
    await tx.insert(jobs).values({ studyId: id, status: "pending" }).onConflictDoNothing();
    await tx.update(studies).set({ status: "queued" }).where(eq(studies.id, id));
  });
}
