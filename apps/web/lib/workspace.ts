import {
  db, coachClients, studyClientAssignments, studies,
  eq, and, asc, desc, inArray,
} from "@valostudy/db";
import { insertWithStudyId } from "@valostudy/db/id";
import { PLAN_LIMITS, studyIdSchema } from "@valostudy/schema";
import { billingStatus } from "./billing";
import { HttpError } from "./http";

async function requireWorkspace(ownerId: string) {
  const entitlement = await billingStatus(ownerId);
  if (!PLAN_LIMITS[entitlement.plan].clientLimit)
    throw new HttpError(403, "Coach Workspace requires Pro");
  return PLAN_LIMITS[entitlement.plan].clientLimit;
}

export async function listClients(ownerId: string) {
  await requireWorkspace(ownerId);
  const clients = await db().select().from(coachClients)
    .where(eq(coachClients.ownerId, ownerId))
    .orderBy(desc(coachClients.createdAt));
  if (!clients.length) return [];

  const assignments = await db().select().from(studyClientAssignments)
    .where(inArray(studyClientAssignments.clientId, clients.map((client) => client.id)));

  return clients.map((client) => ({
    id: client.id,
    displayName: client.displayName,
    riotId: client.riotId,
    notes: client.notes,
    createdAt: client.createdAt.toISOString(),
    studyCount: assignments.filter((assignment) => assignment.clientId === client.id).length,
  }));
}

export async function createClient(
  ownerId: string,
  input: { displayName: string; riotId?: string | null; notes?: string },
) {
  const limit = await requireWorkspace(ownerId);
  const existing = await db().select({ id: coachClients.id }).from(coachClients)
    .where(eq(coachClients.ownerId, ownerId));
  if (existing.length >= limit) throw new HttpError(409, `Pro Coach Workspace supports up to ${limit} clients`);

  return insertWithStudyId(async (id) => {
    const [row] = await db().insert(coachClients).values({
      id,
      ownerId,
      displayName: input.displayName.trim(),
      riotId: input.riotId?.trim() || null,
      notes: input.notes?.trim() ?? "",
    }).onConflictDoNothing({ target: coachClients.id }).returning();
    return row;
  });
}

export async function deleteClient(ownerId: string, clientId: string) {
  await requireWorkspace(ownerId);
  studyIdSchema.parse(clientId);
  const [client] = await db().select().from(coachClients).where(and(
    eq(coachClients.id, clientId),
    eq(coachClients.ownerId, ownerId),
  ));
  if (!client) throw new HttpError(404, "Client not found");
  await db().delete(coachClients).where(eq(coachClients.id, clientId));
}

export async function assignStudy(ownerId: string, clientId: string, studyId: string) {
  await requireWorkspace(ownerId);
  studyIdSchema.parse(clientId);
  studyIdSchema.parse(studyId);

  const [client] = await db().select().from(coachClients).where(and(
    eq(coachClients.id, clientId),
    eq(coachClients.ownerId, ownerId),
  ));
  if (!client) throw new HttpError(404, "Client not found");

  const [study] = await db().select().from(studies).where(and(
    eq(studies.id, studyId),
    eq(studies.ownerId, ownerId),
  ));
  if (!study) throw new HttpError(404, "Study not found");
  if (study.status !== "completed") throw new HttpError(400, "Only completed Studies can be assigned");

  await db().insert(studyClientAssignments).values({
    studyId,
    clientId,
    assignedAt: new Date(),
  }).onConflictDoUpdate({
    target: studyClientAssignments.studyId,
    set: { clientId, assignedAt: new Date() },
  });
}

export async function unassignStudy(ownerId: string, clientId: string, studyId: string) {
  await requireWorkspace(ownerId);
  const [client] = await db().select().from(coachClients).where(and(
    eq(coachClients.id, studyIdSchema.parse(clientId)),
    eq(coachClients.ownerId, ownerId),
  ));
  if (!client) throw new HttpError(404, "Client not found");
  await db().delete(studyClientAssignments).where(and(
    eq(studyClientAssignments.clientId, client.id),
    eq(studyClientAssignments.studyId, studyIdSchema.parse(studyId)),
  ));
}

export async function buildClientManifest(clientId: string, ownerId: string) {
  await requireWorkspace(ownerId);
  studyIdSchema.parse(clientId);
  const [client] = await db().select().from(coachClients).where(and(
    eq(coachClients.id, clientId),
    eq(coachClients.ownerId, ownerId),
  ));
  if (!client) throw new HttpError(404, "Client not found");

  const rows = await db().select({ assignment: studyClientAssignments, study: studies })
    .from(studyClientAssignments)
    .innerJoin(studies, eq(studies.id, studyClientAssignments.studyId))
    .where(eq(studyClientAssignments.clientId, client.id))
    .orderBy(asc(studyClientAssignments.assignedAt));

  return {
    schemaVersion: 1,
    client: {
      id: client.id,
      displayName: client.displayName,
      riotId: client.riotId,
      notes: client.notes,
    },
    studies: rows.map(({ study }) => ({
      studyId: study.id,
      manifestUrl: `/${study.id}/manifest.json`,
      createdAt: study.createdAt.toISOString(),
      completedAt: study.completedAt?.toISOString() ?? null,
      framesExpiredAt: study.framesExpiredAt?.toISOString() ?? null,
      player: study.player,
    })),
    instruction: "Treat these Studies as one player's longitudinal coaching history. Identify persistent habits, regressions, improvements, and map/context-specific patterns using the linked frame evidence.",
  };
}
