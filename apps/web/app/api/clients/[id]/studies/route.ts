import { z } from "zod";
import { assignStudy } from "../../../../../lib/workspace";
import { handle, jsonBody, owner } from "../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ownerId = await owner(request);
    const { studyId } = z.object({ studyId: z.string() }).parse(await jsonBody(request));
    await assignStudy(ownerId, (await context.params).id, studyId);
    return Response.json({ assigned: true });
  });
}
