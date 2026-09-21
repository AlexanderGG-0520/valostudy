import { unassignStudy } from "../../../../../../lib/workspace";
import { handle, owner } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; studyId: string }> },
) {
  return handle(async () => {
    const ownerId = await owner(request);
    const { id, studyId } = await context.params;
    await unassignStudy(ownerId, id, studyId);
    return new Response(null, { status: 204 });
  });
}
