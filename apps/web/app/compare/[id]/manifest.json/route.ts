import { headers } from "next/headers";
import { auth } from "../../../../lib/auth";
import { buildComparisonManifest } from "../../../../lib/comparisons";
import { handle } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await auth().api.getSession({ headers: await headers() });
    const manifest = await buildComparisonManifest((await context.params).id, session?.user.id);
    return Response.json(manifest, { headers: { "Cache-Control": "private, no-store" } });
  });
}
