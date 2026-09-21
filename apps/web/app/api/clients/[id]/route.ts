import { deleteClient } from "../../../../lib/workspace";
import { handle, owner } from "../../../../lib/http";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ownerId = await owner(request);
    await deleteClient(ownerId, (await context.params).id);
    return new Response(null, { status: 204 });
  });
}
