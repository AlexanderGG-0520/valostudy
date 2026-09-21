import { apiOwner } from "../../../../../../lib/api-auth";
import { buildClientManifest } from "../../../../../../lib/workspace";
import { handle } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ownerId = await apiOwner(request);
    return Response.json(await buildClientManifest((await context.params).id, ownerId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
