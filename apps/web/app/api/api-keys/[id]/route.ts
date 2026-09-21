import { handle, owner } from "../../../../lib/http";
import { revokeApiKey } from "../../../../lib/api-auth";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await owner(request);
    await revokeApiKey(userId, (await context.params).id);
    return new Response(null, { status: 204 });
  });
}
