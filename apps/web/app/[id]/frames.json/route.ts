import { auth } from "../../../lib/auth";
import { readableStudy } from "../../../lib/studies";
import { handle, HttpError } from "../../../lib/http";
import { db, frames, asc, eq, sql } from "@valostudy/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 240;
const DEFAULT_PAGE_SIZE = 120;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const session = await auth().api.getSession({ headers: request.headers });
    const study = await readableStudy(id, session?.user.id);
    if (!study || study.status !== "completed" || study.framesExpiredAt)
      throw new HttpError(404, "Frames not found");

    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE));
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
      throw new HttpError(400, "Invalid pagination");

    const [totalRow] = await db()
      .select({ count: sql<number>`count(*)` })
      .from(frames)
      .where(eq(frames.studyId, id));

    const rows = await db()
      .select({ name: frames.name, timestampMs: frames.timestampMs })
      .from(frames)
      .where(eq(frames.studyId, id))
      .orderBy(asc(frames.name))
      .limit(limit)
      .offset(offset);

    return Response.json({
      total: Number(totalRow?.count ?? 0),
      frames: rows.map((frame) => ({
        timestampMs: frame.timestampMs,
        url: "/" + id + "/frames/" + frame.name,
      })),
    }, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
