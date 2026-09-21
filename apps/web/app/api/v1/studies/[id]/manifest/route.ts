import { apiOwner } from "../../../../../../lib/api-auth";
import { buildManifest } from "../../../../../../lib/studies";
import { handle } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await apiOwner(request);
    const manifest = await buildManifest((await context.params).id, userId);
    return Response.json(manifest, { headers: { "Cache-Control": "private, no-store" } });
  });
}
