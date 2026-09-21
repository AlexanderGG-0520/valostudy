import { studyIdSchema } from "@valostudy/schema";
import { handle, owner } from "../../../../../lib/http";
import { enqueueCompletedUpload } from "../../../../../lib/studies";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ownerId = await owner(request);
    const id = studyIdSchema.parse((await context.params).id);
    await enqueueCompletedUpload(id, ownerId);
    return Response.json({ studyId: id, status: "accepted" }, { status: 202 });
  });
}
