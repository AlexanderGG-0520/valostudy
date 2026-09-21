import { auth } from "../../../lib/auth";
import { buildManifest } from "../../../lib/studies";
import { handle } from "../../../lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await auth().api.getSession({ headers: request.headers });
    const manifest = await buildManifest((await context.params).id, session?.user.id);
    return Response.json(manifest, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
