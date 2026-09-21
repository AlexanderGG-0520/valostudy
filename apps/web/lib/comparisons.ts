import { db, studies, studyComparisons, comparisonStudies, eq, and, inArray, asc, desc } from "@valostudy/db";
import { insertWithStudyId } from "@valostudy/db/id";
import { PLAN_LIMITS, studyIdSchema } from "@valostudy/schema";
import { HttpError } from "./http";
import { billingStatus } from "./billing";

export async function listOwnedStudies(ownerId: string) {
  const rows = await db().select({
    id: studies.id,
    status: studies.status,
    visibility: studies.visibility,
    plan: studies.plan,
    player: studies.player,
    createdAt: studies.createdAt,
    completedAt: studies.completedAt,
    framesExpiredAt: studies.framesExpiredAt,
  }).from(studies)
    .where(eq(studies.ownerId, ownerId))
    .orderBy(desc(studies.createdAt))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    framesExpiredAt: row.framesExpiredAt?.toISOString() ?? null,
  }));
}

export async function createComparison(
  ownerId: string,
  studyIds: string[],
  visibility: "private" | "public",
) {
  const entitlement = await billingStatus(ownerId);
  const limit = PLAN_LIMITS[entitlement.plan].compareLimit;
  if (!limit) throw new HttpError(403, "Study comparison requires Plus or Pro");

  const ids = [...new Set(studyIds.map((id) => studyIdSchema.parse(id)))];
  if (ids.length < 2) throw new HttpError(400, "Select at least two Studies");
  if (ids.length > limit) throw new HttpError(403, `This plan compares up to ${limit} Studies`);

  return db().transaction(async (tx) => {
    const selected = await tx.select().from(studies).where(and(
      eq(studies.ownerId, ownerId),
      inArray(studies.id, ids),
    ));
    if (selected.length !== ids.length) throw new HttpError(404, "One or more Studies were not found");
    if (selected.some((study) => study.status !== "completed"))
      throw new HttpError(400, "Only completed Studies can be compared");
    if (visibility === "public" && selected.some((study) => study.visibility !== "public"))
      throw new HttpError(400, "Public comparisons can contain only public Studies");

    const comparison = await insertWithStudyId(async (id) => {
      const [row] = await tx.insert(studyComparisons).values({
        id,
        ownerId,
        visibility,
      }).onConflictDoNothing({ target: studyComparisons.id }).returning();
      return row;
    });

    await tx.insert(comparisonStudies).values(ids.map((studyId, position) => ({
      comparisonId: comparison.id,
      studyId,
      position,
    })));

    return comparison;
  });
}

export async function buildComparisonManifest(id: string, viewerId?: string) {
  if (!studyIdSchema.safeParse(id).success) throw new HttpError(404, "Comparison not found");

  const [comparison] = await db().select().from(studyComparisons)
    .where(eq(studyComparisons.id, id));
  if (!comparison || (comparison.visibility === "private" && comparison.ownerId !== viewerId))
    throw new HttpError(404, "Comparison not found");

  const rows = await db().select({
    position: comparisonStudies.position,
    study: studies,
  }).from(comparisonStudies)
    .innerJoin(studies, eq(studies.id, comparisonStudies.studyId))
    .where(eq(comparisonStudies.comparisonId, id))
    .orderBy(asc(comparisonStudies.position));

  return {
    schemaVersion: 1,
    comparisonId: id,
    visibility: comparison.visibility,
    createdAt: comparison.createdAt.toISOString(),
    studies: rows.map(({ study }) => ({
      studyId: study.id,
      manifestUrl: `/${study.id}/manifest.json`,
      status: study.status,
      player: study.player,
      createdAt: study.createdAt.toISOString(),
      framesExpiredAt: study.framesExpiredAt?.toISOString() ?? null,
    })),
    instruction: "Compare the linked Study manifests as a longitudinal evidence set. Identify repeated mistakes, improvements, and context-dependent differences. Use frame evidence rather than guessing from metadata.",
  };
}
